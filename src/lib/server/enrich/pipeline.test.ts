import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/client';
import { entities, externalIds, jobs, kv, listItems } from '../db/schema';
import { claimNext, recoverInterrupted } from '../jobs/queue';
import { commitAdd } from '../library/service';
import { AppleProvider } from '../providers/apple';
import { fixtureFetch, loadFixtures, type Fixture } from '../providers/fixtures';
import { SlidingWindowLimiter } from '../providers/http';
import { MusicBrainzClient } from '../providers/musicbrainz';
import { recomputeArtistEras } from './pipeline';
import { createEnrichment } from './runner';
import { effectiveFor, setAutoTags, setManualTags, tagsFor } from './tags';

// Recorded from the live APIs by `scripts/record-fixtures.ts enrich`.
const KIND_OF_BLUE = { provider: 'apple', kind: 'album', id: '268443092', country: 'us' } as const;
const SO_WHAT = { provider: 'apple', kind: 'track', id: '268443097', country: 'us' } as const;
const GOLDBERG = { provider: 'apple', kind: 'album', id: '476935391', country: 'us' } as const;
const UA = 'MusicMap/0.1 (https://github.com/bboyd01/music-map)';
const MB_KOB_SEARCH = (f: Fixture) => f.request.url.startsWith('https://musicbrainz.org/ws/2/release-group/?') && f.request.url.includes('kind+of+blue');

let dir: string;
let db: DB;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enrich-'));
	db = openDb(':memory:');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function setup({ extra = [] as Fixture[], mb = true } = {}) {
	const fetchImpl = fixtureFetch([...extra, ...loadFixtures('enrich.json')]);
	const providers = { apple: new AppleProvider({ fetchImpl, limiter: new SlidingWindowLimiter(100, 1) }), spotify: null };
	let mbCalls = 0;
	const limiter = new SlidingWindowLimiter(100, 1);
	const counting = Object.assign(Object.create(limiter), { acquire: () => (mbCalls++, limiter.acquire()) });
	const client = mb ? new MusicBrainzClient({ userAgent: UA, fetchImpl, limiter: counting, retryDelayMs: 0 }) : null;
	const e = createEnrichment({ db, mb: client, providers, artworkDir: dir, fetchImpl });
	const add = (ref: Parameters<typeof commitAdd>[1]) =>
		commitAdd({ db, providers, artworkDir: dir, fetchImpl, enqueueEnrich: e.enqueue }, ref);
	return { ...e, add, fetchImpl, mbCalls: () => mbCalls };
}

const byName = (name: string) => db.select().from(entities).where(eq(entities.name, name)).get()!;
const own = (id: number, facet: string) =>
	tagsFor(db, [id]).get(id)!.filter((t) => t.facet === facet).map((t) => t.name).sort();
const eff = (id: number, facet: 'genre' | 'era' | 'instrument') => effectiveFor(db, [id]).get(id)![facet];
const mbid = (id: number) =>
	db.select().from(externalIds).where(eq(externalIds.entityId, id)).all().find((x) => x.provider === 'musicbrainz')?.externalId;

describe('enrichment pipeline (recorded fixtures)', () => {
	it('tags an album with MusicBrainz genres, decade and instruments, and enriches its artist', async () => {
		const { add, worker, fetchImpl, mbCalls } = setup();
		await add(KIND_OF_BLUE);
		expect(byName('Kind of Blue').enrichStatus).toBe('pending');
		expect(await worker.drain()).toBe(3); // album, artist, then the artist's suggestions

		const album = byName('Kind of Blue');
		expect(album.enrichStatus).toBe('done');
		expect(mbid(album.id)).toBe('8e8a594f-2175-38c7-a871-abb68ec363e7');
		expect(own(album.id, 'genre')).toEqual(['cool jazz', 'jazz']);
		expect(own(album.id, 'era')).toEqual(['1950s']);
		expect(own(album.id, 'instrument')).toEqual(
			expect.arrayContaining(['trumpet', 'piano', 'tenor saxophone', 'alto saxophone', 'double bass', 'drums'])
		);

		const artist = byName('Miles Davis');
		expect(artist.enrichStatus).toBe('done');
		expect(mbid(artist.id)).toBe('561d854a-6a28-4aa7-8c99-323e6ce46c2a');
		expect(own(artist.id, 'genre')).toContain('jazz');
		expect(own(artist.id, 'instrument')).toEqual(['trumpet']);
		expect(own(artist.id, 'era')).toEqual(['1950s']);

		// Every MusicBrainz request went through the limiter and carried the User-Agent.
		const mbRequests = fetchImpl.calls.filter((c) => c.url.startsWith('https://musicbrainz.org/'));
		expect(mbRequests.length).toBeGreaterThan(0);
		expect(mbCalls()).toBe(mbRequests.length);
		for (const c of mbRequests) expect(new Headers(c.init?.headers).get('user-agent')).toBe(UA);
	});

	it('gives tracks their own instruments and lets them inherit genre and era from the album', async () => {
		const { add, worker } = setup();
		await add(SO_WHAT);
		await worker.drain();
		const track = byName('So What');
		expect(track.enrichStatus).toBe('done');
		expect(mbid(track.id)).toBeDefined();
		expect(own(track.id, 'genre')).toEqual([]);
		expect(own(track.id, 'instrument')).toContain('trumpet');
		expect(eff(track.id, 'genre')).toMatchObject({ inheritedFrom: { kind: 'album' } });
		expect(eff(track.id, 'genre').tags.map((t) => t.name)).toContain('jazz');
		expect(eff(track.id, 'era').tags.map((t) => t.name)).toEqual(['1950s']);
	});

	it("gives a classical album its composer's period as well as the recording decade", async () => {
		const { add, worker } = setup();
		await add(GOLDBERG);
		await worker.drain();
		const album = byName('Bach: Goldberg Variations, BWV 988 (1981 Recording)');
		expect(own(album.id, 'genre')).toContain('classical');
		expect(own(album.id, 'era')).toEqual(['1980s', 'Baroque']);
		// The performer is not a composer: his era is the union of his releases'.
		expect(own(byName('Glenn Gould').id, 'era')).toEqual(['1980s', 'Baroque']);
	});

	it('keeps manual tags through re-enrichment', async () => {
		const { add, worker, enqueue: requeue } = setup();
		await add(KIND_OF_BLUE);
		await worker.drain();
		const album = byName('Kind of Blue');
		setManualTags(db, album.id, 'genre', ['modal jazz']);
		setAutoTags(db, album.id, 'era', []); // wipe an auto facet to prove re-enrichment ran

		requeue({ entityId: album.id });
		expect(await worker.drain()).toBeGreaterThan(0);
		expect(tagsFor(db, [album.id]).get(album.id)!.filter((t) => t.facet === 'genre')).toEqual([
			expect.objectContaining({ name: 'modal jazz', source: 'manual' })
		]);
		expect(own(album.id, 'era')).toEqual(['1950s']);
	});

	it('resumes a job interrupted by a restart exactly once', async () => {
		const { add, worker } = setup();
		await add(KIND_OF_BLUE);
		const job = claimNext(db)!; // the process "dies" while this job is running
		expect(job.status).toBe('running');
		expect(recoverInterrupted(db)).toBe(1); // next boot
		expect(await worker.drain()).toBe(3);
		expect(db.select().from(jobs).all().map((j) => [j.type, j.status, j.attempts])).toEqual([
			['enrich', 'done', 2],
			['enrich', 'done', 1],
			['suggest', 'done', 1]
		]);
		expect(own(byName('Kind of Blue').id, 'genre')).toEqual(['cool jazz', 'jazz']);
	});

	it('leaves the item usable with local tags when MusicBrainz keeps failing', async () => {
		const failing = loadFixtures('enrich.json')
			.filter(MB_KOB_SEARCH)
			.map((f) => ({ ...f, status: 500, body: '' }));
		const { add, worker } = setup({ extra: failing });
		await add(KIND_OF_BLUE);
		const album = byName('Kind of Blue');
		for (let attempt = 1; attempt <= 3; attempt++) {
			db.update(jobs).set({ runAfter: '2000-01-01T00:00:00.000Z' }).where(eq(jobs.status, 'queued')).run();
			await worker.drain();
		}
		expect(db.select().from(jobs).get()).toMatchObject({ status: 'failed', attempts: 3 });
		expect(byName('Kind of Blue').enrichStatus).toBe('failed');
		expect(db.select().from(listItems).where(eq(listItems.entityId, album.id)).get()).toBeDefined();
		expect(own(album.id, 'genre')).toEqual(['jazz']); // from Apple
		expect(own(album.id, 'era')).toEqual(['1950s']);
	});

	it('works without MusicBrainz (no MB_USER_AGENT): provider genre and decade only', async () => {
		const { add, worker, fetchImpl } = setup({ mb: false });
		await add(KIND_OF_BLUE);
		await worker.drain();
		const album = byName('Kind of Blue');
		expect(album.enrichStatus).toBe('done');
		expect(own(album.id, 'genre')).toEqual(['jazz']);
		expect(own(album.id, 'era')).toEqual(['1950s']);
		expect(fetchImpl.calls.some((c) => c.url.includes('musicbrainz.org'))).toBe(false);
	});

	it('retries a MusicBrainz 503 once', async () => {
		const kob = loadFixtures('enrich.json').find(MB_KOB_SEARCH)!;
		let first = true;
		const base = fixtureFetch(loadFixtures('enrich.json'));
		const flaky: typeof fetch = async (input, init) => {
			if (String(input) === kob.request.url && first) {
				first = false;
				return new Response('', { status: 503 });
			}
			return base(input, init);
		};
		const client = new MusicBrainzClient({ userAgent: UA, fetchImpl: flaky, limiter: new SlidingWindowLimiter(100, 1), retryDelayMs: 0 });
		const groups = await client.searchReleaseGroups('kind of blue', 'miles davis');
		expect(groups[0]).toMatchObject({ id: '8e8a594f-2175-38c7-a871-abb68ec363e7', title: 'Kind of Blue' });
		expect(first).toBe(false);
	});
});

describe('recomputeArtistEras', () => {
	it('gives credited classical composers the period of their lifespan', () => {
		const bach = db.insert(entities).values({ kind: 'artist', name: 'Johann Sebastian Bach', normKey: 'a' }).returning().get();
		db.insert(externalIds).values({ entityId: bach.id, provider: 'musicbrainz', externalId: 'bach' }).run();
		db.insert(kv).values([
			{ key: 'mb:artist:bach', value: JSON.stringify({ type: 'Person', begin: '1685-03-31', end: '1750-07-28' }) },
			{ key: 'mb:composer:bach', value: '1' }
		]).run();
		setAutoTags(db, bach.id, 'genre', ['baroque', 'classical']);
		const album = db.insert(entities).values({ kind: 'album', name: 'x', normKey: 'b', artistId: bach.id }).returning().get();
		setAutoTags(db, album.id, 'era', ['1990s']);
		recomputeArtistEras(db, bach.id);
		expect(own(bach.id, 'era')).toEqual(['Baroque']);
	});

	it('leaves manual artist eras alone', () => {
		const a = db.insert(entities).values({ kind: 'artist', name: 'x', normKey: 'a' }).returning().get();
		setManualTags(db, a.id, 'era', ['1960s']);
		recomputeArtistEras(db, a.id);
		expect(tagsFor(db, [a.id]).get(a.id)).toEqual([expect.objectContaining({ name: '1960s', source: 'manual' })]);
	});
});
