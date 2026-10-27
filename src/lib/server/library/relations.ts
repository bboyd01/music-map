import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { canonicalEdge } from '../../domain/edges';
import { normKey } from '../../domain/normalize';
import { escapeLike, type DbOrTx } from '../db/client';
import { edges, entities, type Edge, type Entity } from '../db/schema';
import type { EntitySummary } from '../../types';
import { collectGarbage, ensureEntity } from './entities';

export const EdgeInput = z.object({
	type: z.enum(['inspired', 'similar']),
	from: z.number().int().positive(),
	to: z.number().int().positive(),
	note: z.string().trim().max(500).nullish()
});

export type AddEdgeResult = { ok: true; edge: Edge; created: boolean } | { ok: false; status: 400 | 404; message: string };

/**
 * Creates an edge (or accepts an existing suggested/rejected one). `similar` is stored once
 * regardless of direction, so adding it "from the other side" returns the same row.
 */
export function addEdge(
	db: DbOrTx,
	input: z.infer<typeof EdgeInput>,
	source: Edge['source'] = 'manual'
): AddEdgeResult {
	const ends = canonicalEdge(input.type, input.from, input.to);
	if (!ends) return { ok: false, status: 400, message: 'An item can’t be linked to itself.' };
	const found = db
		.select({ id: entities.id })
		.from(entities)
		.where(inArray(entities.id, [ends.from, ends.to]))
		.all();
	if (found.length !== 2) return { ok: false, status: 404, message: 'Item not found.' };

	const where = and(eq(edges.type, input.type), eq(edges.fromId, ends.from), eq(edges.toId, ends.to));
	const existing = db.select().from(edges).where(where).get();
	if (existing) {
		if (existing.status === 'accepted') return { ok: true, edge: existing, created: false };
		const edge = db
			.update(edges)
			.set({ status: 'accepted', note: input.note ?? existing.note })
			.where(eq(edges.id, existing.id))
			.returning()
			.get();
		return { ok: true, edge, created: false };
	}
	const edge = db
		.insert(edges)
		.values({ type: input.type, fromId: ends.from, toId: ends.to, status: 'accepted', source, note: input.note ?? null })
		.returning()
		.get();
	return { ok: true, edge, created: true };
}

/** Deletes an edge, then removes either end if it was a stub nothing else needs. */
export function removeEdge(db: DbOrTx, id: number): { removed: boolean; deletedEntities: number[] } {
	const edge = db.delete(edges).where(eq(edges.id, id)).returning().get();
	if (!edge) return { removed: false, deletedEntities: [] };
	return { removed: true, deletedEntities: [...collectGarbage(db, edge.fromId), ...collectGarbage(db, edge.toId)] };
}

export function setEdgeStatus(db: DbOrTx, id: number, status: Edge['status']): Edge | undefined {
	return db.update(edges).set({ status }).where(eq(edges.id, id)).returning().get();
}

export const StubInput = z.object({
	kind: z.enum(['artist', 'album', 'track']),
	name: z.string().trim().min(1).max(300),
	artistName: z.string().trim().max(300).optional()
});

/**
 * Creates a stub (an entity with no list item) for linking, reusing an existing entity with
 * the same identity. Albums/tracks get their artist created too when one is given.
 */
export function createStub(db: DbOrTx, input: z.infer<typeof StubInput>): { entity: Entity; created: boolean } {
	const artistName = input.kind === 'artist' ? undefined : input.artistName || undefined;
	const artist = artistName
		? ensureEntity(db, { kind: 'artist', name: artistName, normKey: normKey('artist', { name: artistName }) }).entity
		: undefined;
	const { entity, created } = ensureEntity(db, {
		kind: input.kind,
		name: input.name,
		normKey: normKey(input.kind, { name: input.name, artistName: artistName ?? '' }),
		artistId: artist?.id
	});
	return { entity, created };
}

/**
 * "In your library": the entity, or (for artists and albums) one of its tracks/releases, is on the
 * listening list. Everything else is a stub. Artists never have list items of their own.
 */
export const listedSql = sql<number>`exists (
	select 1 from listen_items li join entities c on c.id = li.entity_id
	where c.id = ${entities.id} or c.artist_id = ${entities.id} or c.album_id = ${entities.id}
)`;

const artist = alias(entities, 'artist');
const album = alias(entities, 'album');

function summaryQuery(db: DbOrTx) {
	return db
		.select({
			id: entities.id,
			kind: entities.kind,
			name: entities.name,
			artistName: artist.name,
			artworkPath: sql<string | null>`coalesce(${entities.artworkPath}, ${album.artworkPath})`,
			listed: listedSql
		})
		.from(entities)
		.leftJoin(artist, eq(artist.id, entities.artistId))
		.leftJoin(album, eq(album.id, entities.albumId));
}

const toSummary = (r: Omit<EntitySummary, 'listed'> & { listed: number }): EntitySummary => ({ ...r, listed: Boolean(r.listed) });

export function summaries(db: DbOrTx, ids: number[]): Map<number, EntitySummary> {
	if (!ids.length) return new Map();
	return new Map(summaryQuery(db).where(inArray(entities.id, ids)).all().map((r) => [r.id, toSummary(r)]));
}

/** Local search over the user's own entities (for the link picker and merge). */
export function searchEntities(db: DbOrTx, q: string, kind?: Entity['kind'], limit = 20): EntitySummary[] {
	const term = q.trim();
	if (!term) return [];
	const contains = `%${escapeLike(term)}%`;
	const prefix = `${escapeLike(term)}%`;
	return summaryQuery(db)
		.where(
			and(
				kind ? eq(entities.kind, kind) : undefined,
				or(sql`${entities.name} like ${contains} escape '\\'`, sql`${artist.name} like ${contains} escape '\\'`)
			)
		)
		.orderBy(sql`${entities.name} like ${prefix} escape '\\' desc`, sql`${listedSql} desc`, entities.name)
		.limit(limit)
		.all()
		.map(toSummary);
}

