import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/client';
import { edges, entities, jobs, kv, listItems } from '../db/schema';
import { getGraph, GraphQuery } from '../library/graph';
import { createStub } from '../library/relations';
import { fixtureFetch, loadFixtures, type Fixture } from '../providers/fixtures';
import { SlidingWindowLimiter } from '../providers/http';
import { LastfmClient } from '../providers/lastfm';
import { MusicBrainzClient } from '../providers/musicbrainz';
import { WikidataClient } from '../providers/wikidata';
import { createEnrichment } from './runner';
import { generateSuggestions, listSuggestions, reviewSuggestion } from './suggestions';

// enrich.json is recorded (scripts/record-fixtures.ts enrich): Beethoven has MusicBrainz teacher
// relationships and Wikidata "influenced by" Fux, Bach, Haydn and Mozart.
const UA = 'MusicMap/0.1 (https://github.com/bboyd01/music-map)';
const BEETHOVEN_MBID = '1f9df192-a621-4f54-8850-2c5373b7eac9';
const fast = () => new SlidingWindowLimiter(100, 1);

let dir: string;
let db: DB;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'suggest-'));
	db = openDb(':memory:');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

async function beethoven(extra: Fixture[] = []) {
	const fetchImpl = fixtureFetch([...extra, ...loadFixtures('enrich.json')]);
	const e = createEnrichment({
		db,
		mb: new MusicBrainzClient({ userAgent: UA, fetchImpl, limiter: fast(), retryDelayMs: 0 }),
		wikidata: new WikidataClient({ userAgent: UA, fetchImpl, limiter: fast() }),
		providers: { apple: null as never, spotify: null },
		artworkDir: dir,
		fetchImpl
	});
	const { entity } = createStub(db, { kind: 'artist', name: 'Ludwig van Beethoven' });
	e.enqueue({ entityId: entity.id });
	await e.worker.drain();
	return { ...e, id: entity.id, fetchImpl };
}

const named = (name: string) => db.select().from(entities).where(eq(entities.name, name)).get();
const edgeBetween = (fromName: string, toName: string) =>
	db
		.select()
		.from(edges)
		.where(and(eq(edges.fromId, named(fromName)!.id), eq(edges.toId, named(toName)!.id)))
		.get();

describe('suggestions (recorded fixtures)', () => {
	it('proposes influences from Wikidata and MusicBrainz, deduped across sources', async () => {
		const { id } = await beethoven();
		const all = listSuggestions(db, id);
		expect(all).toHaveLength(12); // 9 teacher rels + 4 Wikidata influences − Haydn (in both)
		expect(edgeBetween('Johann Sebastian Bach', 'Ludwig van Beethoven')).toMatchObject({ type: 'inspired', status: 'suggested', source: 'wikidata' });
		expect(edgeBetween('Joseph Haydn', 'Ludwig van Beethoven')).toMatchObject({ status: 'suggested' });
		expect(edgeBetween('Ludwig van Beethoven', 'Carl Czerny')).toMatchObject({ source: 'musicbrainz' }); // his student
		expect(db.select().from(edges).where(eq(edges.toId, id)).all().filter((e) => named('Joseph Haydn')!.id === e.fromId)).toHaveLength(1);
	});

	it('creates suggestion targets as stubs without enriching them (no cascade)', async () => {
		await beethoven();
		const bach = named('Johann Sebastian Bach')!;
		expect(bach.enrichStatus).toBe('done');
		expect(db.select().from(listItems).all()).toEqual([]);
		const queued = db.select().from(jobs).all().map((j) => (j.payload as { entityId: number }).entityId);
		expect(queued).not.toContain(bach.id);
	});

	it('never re-proposes a rejected suggestion, and cleans up the orphaned stub', async () => {
		const e = await beethoven();
		const edge = edgeBetween('Johann Sebastian Bach', 'Ludwig van Beethoven')!;
		const bachId = edge.fromId;
		expect(reviewSuggestion(db, edge.id, 'reject')).toMatchObject({ ok: true, status: 'rejected', deletedEntities: [bachId] });
		expect(named('Johann Sebastian Bach')).toBeUndefined();
		expect(db.select().from(kv).all().some((r) => r.key.startsWith('rejected:inspired:'))).toBe(true);

		// Re-running suggestions (e.g. after "Refresh details") doesn't bring it back.
		e.enqueue({ entityId: e.id });
		await e.worker.drain();
		expect(named('Johann Sebastian Bach')).toBeUndefined();
		expect(listSuggestions(db, e.id)).toHaveLength(11);
	});

	it('accepting makes a normal edge on the map and asks for the stub to be enriched', async () => {
		const { id } = await beethoven();
		const edge = edgeBetween('Wolfgang Amadeus Mozart', 'Ludwig van Beethoven')!;
		const mapLinks = () => getGraph(db, GraphQuery.parse({ kind: 'artist', layers: 'inspired' })).links.map((l) => l.edgeId);
		expect(mapLinks()).not.toContain(edge.id); // suggested edges are hidden unless asked for
		expect(getGraph(db, GraphQuery.parse({ kind: 'artist', layers: 'inspired', suggested: '1' })).links.find((l) => l.edgeId === edge.id)).toMatchObject({ status: 'suggested' });

		const res = reviewSuggestion(db, edge.id, 'accept');
		expect(res).toMatchObject({ ok: true, status: 'accepted', toEnrich: [edge.fromId] });
		expect(mapLinks()).toContain(edge.id);
		expect(listSuggestions(db, id)).toHaveLength(11);
	});

	it('accept-and-add puts album/track ends on the list', () => {
		const a = createStub(db, { kind: 'album', name: 'A' }).entity;
		const b = createStub(db, { kind: 'album', name: 'B' }).entity;
		const e = db.insert(edges).values({ type: 'similar', fromId: a.id, toId: b.id, status: 'suggested', source: 'lastfm' }).returning().get();
		expect(reviewSuggestion(db, e.id, 'accept', { addToList: true })).toMatchObject({ promoted: [a.id, b.id] });
		expect(reviewSuggestion(db, 999, 'reject')).toEqual({ ok: false, status: 404 });
	});
});

describe('Last.fm similar artists (hand-written fixture: no API key when written)', () => {
	const KEY = 'test-key';
	const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&api_key=${KEY}&format=json&limit=20&mbid=${BEETHOVEN_MBID}`;
	const similar: Fixture = {
		request: { url },
		status: 200,
		note: 'Hand-written from the Last.fm artist.getSimilar docs.',
		body: {
			similarartists: {
				artist: [
					{ name: 'Wolfgang Amadeus Mozart', mbid: 'b972f589-fb0e-474e-b64a-803b0364fa75', match: '1' },
					{ name: 'Franz Schubert', mbid: '', match: '0.71' },
					{ name: 'Some Cover Band', mbid: '', match: '0.12' }
				],
				'@attr': { artist: 'Ludwig van Beethoven' }
			}
		}
	};

	it('suggests similar artists above the match threshold, reusing known artists', async () => {
		const { id } = await beethoven();
		const fetchImpl = fixtureFetch([similar]);
		const created = await generateSuggestions(
			{ db, wikidata: null, lastfm: new LastfmClient({ apiKey: KEY, fetchImpl }) },
			{ entityId: id }
		);
		expect(created).toBe(2);
		const sims = listSuggestions(db, id).filter((s) => s.type === 'similar');
		expect(sims.map((s) => [s.from.name, s.to.name].find((n) => n !== 'Ludwig van Beethoven')).sort()).toEqual(['Franz Schubert', 'Wolfgang Amadeus Mozart']);
		expect(db.select().from(entities).where(eq(entities.name, 'Wolfgang Amadeus Mozart')).all()).toHaveLength(1);
		expect(named('Some Cover Band')).toBeUndefined();
	});
});
