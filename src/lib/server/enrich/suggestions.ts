import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { canonicalEdge, type EdgeType } from '../../domain/edges';
import { normKey } from '../../domain/normalize';
import type { SuggestionView } from '../../types';
import type { DbOrTx } from '../db/client';
import { edges, entities, entityTags, externalIds, kv, type Edge, type Entity } from '../db/schema';
import { collectGarbage } from '../library/entities';
import { promoteToList } from '../library/list';
import { summaries } from '../library/relations';
import type { LastfmClient } from '../providers/lastfm';
import type { WikidataClient } from '../providers/wikidata';

export interface SuggestPayload {
	entityId: number;
	/** Wikidata QID of the artist (from MusicBrainz url-rels). */
	wikidata?: string;
	/** MusicBrainz teacher relationships. */
	teachers?: { id: string; name: string }[];
	students?: { id: string; name: string }[];
}

export interface SuggestDeps {
	db: DbOrTx;
	wikidata: WikidataClient | null;
	lastfm: LastfmClient | null;
	log?: (msg: string) => void;
}

interface Candidate {
	type: EdgeType;
	/** in: the candidate inspired the artist. out: the artist inspired the candidate. */
	dir: 'in' | 'out';
	name: string;
	mbid?: string;
	qid?: string;
	source: Edge['source'];
}

/** Rejections are remembered by identity (norm keys), so they outlive garbage-collected stubs. */
export function rejectionKey(type: EdgeType, fromKey: string, toKey: string): string {
	const [a, b] = type === 'similar' ? [fromKey, toKey].sort() : [fromKey, toKey];
	return `rejected:${type}:${a}>${b}`;
}

function findArtist(db: DbOrTx, c: Candidate): Entity | undefined {
	for (const [provider, id] of [
		['musicbrainz', c.mbid],
		['wikidata', c.qid]
	] as const) {
		if (!id) continue;
		const hit = db
			.select({ e: entities })
			.from(externalIds)
			.innerJoin(entities, eq(entities.id, externalIds.entityId))
			.where(and(eq(externalIds.provider, provider), eq(externalIds.externalId, id)))
			.get();
		if (hit) return hit.e;
	}
	return db
		.select()
		.from(entities)
		.where(and(eq(entities.kind, 'artist'), eq(entities.normKey, normKey('artist', { name: c.name }))))
		.get();
}

function attachIds(db: DbOrTx, entityId: number, c: Candidate) {
	const ids = [
		c.mbid && { provider: 'musicbrainz' as const, externalId: c.mbid, url: `https://musicbrainz.org/artist/${c.mbid}` },
		c.qid && { provider: 'wikidata' as const, externalId: c.qid, url: `https://www.wikidata.org/wiki/${c.qid}` }
	].filter((x) => !!x);
	for (const x of ids) db.insert(externalIds).values({ entityId, ...x }).onConflictDoNothing().run();
}

/** Adds one suggested edge, creating a stub artist if needed. Returns true if a new suggestion was made. */
function addSuggestion(db: DbOrTx, owner: Entity, c: Candidate): boolean {
	let other = findArtist(db, c);
	const otherKey = other?.normKey ?? normKey('artist', { name: c.name });
	if (other?.id === owner.id || otherKey === owner.normKey) return false;
	const [fromKey, toKey] = c.dir === 'in' ? [otherKey, owner.normKey] : [owner.normKey, otherKey];
	if (db.select().from(kv).where(eq(kv.key, rejectionKey(c.type, fromKey, toKey))).get()) return false;

	if (!other) {
		// Suggestion stubs aren't enriched until accepted, so suggestions don't cascade.
		other = db.insert(entities).values({ kind: 'artist', name: c.name, normKey: otherKey, enrichStatus: 'done' }).returning().get();
	}
	attachIds(db, other.id, c);
	const ends = canonicalEdge(c.type, c.dir === 'in' ? other.id : owner.id, c.dir === 'in' ? owner.id : other.id)!;
	const res = db
		.insert(edges)
		.values({ type: c.type, fromId: ends.from, toId: ends.to, status: 'suggested', source: c.source })
		.onConflictDoNothing()
		.run();
	return res.changes > 0;
}

/** `suggest` job: proposes inspired/similar edges for an artist from MusicBrainz, Wikidata and Last.fm. */
export async function generateSuggestions(deps: SuggestDeps, payload: SuggestPayload): Promise<number> {
	const owner = deps.db.select().from(entities).where(eq(entities.id, payload.entityId)).get();
	if (!owner || owner.kind !== 'artist') return 0;

	const candidates: Candidate[] = [
		...(payload.teachers ?? []).map((t) => ({ type: 'inspired' as const, dir: 'in' as const, name: t.name, mbid: t.id, source: 'musicbrainz' as const })),
		...(payload.students ?? []).map((t) => ({ type: 'inspired' as const, dir: 'out' as const, name: t.name, mbid: t.id, source: 'musicbrainz' as const }))
	];
	if (payload.wikidata && deps.wikidata) {
		for (const inf of await deps.wikidata.influencesOf(payload.wikidata)) {
			candidates.push({ type: 'inspired', dir: 'in', name: inf.label, mbid: inf.mbid, qid: inf.qid, source: 'wikidata' });
		}
	}
	if (deps.lastfm) {
		const mbid = deps.db
			.select({ id: externalIds.externalId })
			.from(externalIds)
			.where(and(eq(externalIds.entityId, owner.id), eq(externalIds.provider, 'musicbrainz')))
			.get()?.id;
		for (const s of await deps.lastfm.similarArtists(owner.name, mbid)) {
			candidates.push({ type: 'similar', dir: 'out', name: s.name, mbid: s.mbid, source: 'lastfm' });
		}
	}

	let created = 0;
	for (const c of candidates) if (addSuggestion(deps.db, owner, c)) created++;
	if (created) deps.log?.(`${created} suggestion(s) for ${owner.name}`);
	return created;
}


/** Pending suggestions, newest first; optionally only those touching one entity. */
export function listSuggestions(db: DbOrTx, entityId?: number, limit = 200): SuggestionView[] {
	const rows = db
		.select()
		.from(edges)
		.where(
			and(
				eq(edges.status, 'suggested'),
				entityId === undefined ? undefined : or(eq(edges.fromId, entityId), eq(edges.toId, entityId))
			)
		)
		.orderBy(desc(edges.createdAt), desc(edges.id))
		.limit(limit)
		.all();
	const info = summaries(db, [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))]);
	return rows.flatMap((r) => {
		const from = info.get(r.fromId);
		const to = info.get(r.toId);
		return from && to ? [{ edgeId: r.id, type: r.type, source: r.source, createdAt: r.createdAt, from, to }] : [];
	});
}

export function countSuggestions(db: DbOrTx): number {
	return db.select({ n: sql<number>`count(*)` }).from(edges).where(eq(edges.status, 'suggested')).get()!.n;
}

export type ReviewResult =
	| { ok: true; status: Edge['status']; deletedEntities: number[]; toEnrich: number[]; promoted: number[] }
	| { ok: false; status: 404 };

/**
 * Accept or reject a suggestion. Rejecting remembers the pair (so it's never proposed again) and
 * removes stubs nothing else needs. Accepting returns tagless stubs to enrich; with `addToList`,
 * album/track ends are put on the listening list.
 */
export function reviewSuggestion(db: DbOrTx, edgeId: number, action: 'accept' | 'reject', { addToList = false } = {}): ReviewResult {
	const edge = db.select().from(edges).where(eq(edges.id, edgeId)).get();
	if (!edge) return { ok: false, status: 404 };
	const ends = db.select().from(entities).where(inArray(entities.id, [edge.fromId, edge.toId])).all();
	const byId = new Map(ends.map((e) => [e.id, e]));

	if (action === 'reject') {
		db.update(edges).set({ status: 'rejected' }).where(eq(edges.id, edgeId)).run();
		const key = rejectionKey(edge.type, byId.get(edge.fromId)!.normKey, byId.get(edge.toId)!.normKey);
		db.insert(kv).values({ key, value: new Date().toISOString() }).onConflictDoNothing().run();
		return {
			ok: true,
			status: 'rejected',
			deletedEntities: [...collectGarbage(db, edge.fromId), ...collectGarbage(db, edge.toId)],
			toEnrich: [],
			promoted: []
		};
	}

	db.update(edges).set({ status: 'accepted' }).where(eq(edges.id, edgeId)).run();
	const tagged = new Set(
		db.select({ id: entityTags.entityId }).from(entityTags).where(inArray(entityTags.entityId, [edge.fromId, edge.toId])).all().map((r) => r.id)
	);
	const promoted = addToList
		? ends.filter((e) => e.kind !== 'artist' && promoteToList(db, e.id) === 'promoted').map((e) => e.id)
		: [];
	return { ok: true, status: 'accepted', deletedEntities: [], toEnrich: ends.filter((e) => !tagged.has(e.id)).map((e) => e.id), promoted };
}
