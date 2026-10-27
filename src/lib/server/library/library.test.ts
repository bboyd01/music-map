import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/client';
import { entities, externalIds, listItems } from '../db/schema';
import { AppleProvider } from '../providers/apple';
import { fixtureFetch, loadFixtures, type Fixture } from '../providers/fixtures';
import { SlidingWindowLimiter } from '../providers/http';
import { SpotifyProvider } from '../providers/spotify';
import { getList, ListQuery, promoteToList, removeFromList, updateListItem } from './list';
import { commitAdd, resolveForAdd } from './service';

const APPLE_ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music/7f/9f/d6/mzi.vtnaewef.jpg/600x600bb.jpg';
const SPOTIFY_ART = 'https://i.scdn.co/image/ab67616d0000b2737ab89c25093ea3787b1995b4';
const image = (url: string): Fixture => ({ request: { url }, status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'jpg' });

let dir: string;
let db: DB;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'library-'));
	db = openDb(':memory:');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function deps(extra: Fixture[] = [], { spotify = true } = {}) {
	const fetchImpl = fixtureFetch([...extra, image(APPLE_ART), image(SPOTIFY_ART), ...loadFixtures('apple.json', 'spotify.json')]);
	return {
		db,
		artworkDir: dir,
		fetchImpl,
		providers: {
			apple: new AppleProvider({ fetchImpl, limiter: new SlidingWindowLimiter(100, 1) }),
			spotify: spotify ? new SpotifyProvider({ clientId: 'a', clientSecret: 'b', fetchImpl }) : null
		}
	};
}

const list = (q: Partial<ListQuery> = {}) => getList(db, ListQuery.parse(q));
const KIND_OF_BLUE = { provider: 'apple', kind: 'album', id: '268443092', country: 'us' } as const;
const SO_WHAT = { provider: 'apple', kind: 'track', id: '268443097', country: 'us' } as const;

describe('add flow', () => {
	it('adds an Apple album with artist, artwork and a to_listen item', async () => {
		const res = await commitAdd(deps(), KIND_OF_BLUE);
		expect(res).toMatchObject({ ok: true, outcome: 'added', name: 'Kind of Blue' });
		const rows = list();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'album', name: 'Kind of Blue', artistName: 'Miles Davis', releaseDate: '1959-08-17', status: 'to_listen', enrichStatus: 'pending' });
		expect(rows[0].artworkPath).toMatch(/^[a-f0-9]{32}\.jpg$/);
		expect(db.select().from(entities).all().map((e) => e.kind).sort()).toEqual(['album', 'artist']);
		expect(db.select().from(externalIds).all()).toHaveLength(2);
	});

	it('adds a track with its album as a stub sharing the artwork', async () => {
		await commitAdd(deps(), SO_WHAT);
		const all = db.select().from(entities).all();
		const track = all.find((e) => e.kind === 'track')!;
		const album = all.find((e) => e.kind === 'album')!;
		expect(track).toMatchObject({ name: 'So What', durationMs: 547983, albumId: album.id });
		expect(album.artworkPath).toBe(track.artworkPath);
		expect(db.select().from(listItems).all().map((l) => l.entityId)).toEqual([track.id]);
	});

	it('attaches a Spotify link for the same album to the existing entity', async () => {
		const d = deps();
		await commitAdd(d, KIND_OF_BLUE);
		const res = await commitAdd(d, { provider: 'spotify', kind: 'album', id: '1weenld61qoidwYuZ1GESA' });
		expect(res).toMatchObject({ ok: true, outcome: 'existing', attachedProvider: true, message: 'Kind Of Blue is already in your list.' });
		expect(list()).toHaveLength(1);
		expect(db.select().from(entities).all().filter((e) => e.kind === 'album')).toHaveLength(1);
		const ids = db.select().from(externalIds).all().map((x) => `${x.provider}:${x.externalId}`).sort();
		expect(ids).toEqual(['apple:268443092', 'apple:44984', 'spotify:0kbYTNQb4Pb1rPbbaF0pT4', 'spotify:1weenld61qoidwYuZ1GESA']);
	});

	it('promotes an album that exists only as a stub', async () => {
		const d = deps();
		await commitAdd(d, SO_WHAT); // creates the Kind of Blue album stub
		const res = await commitAdd(d, KIND_OF_BLUE);
		expect(res).toMatchObject({ ok: true, outcome: 'promoted' });
		expect(list().map((r) => r.name).sort()).toEqual(['Kind of Blue', 'So What']);
	});

	it('re-adding the same link reports it as existing', async () => {
		const d = deps();
		await commitAdd(d, KIND_OF_BLUE);
		expect(await commitAdd(d, KIND_OF_BLUE)).toMatchObject({ ok: true, outcome: 'existing', attachedProvider: false });
	});

	it('still adds the item when artwork download fails', async () => {
		const d = deps([{ request: { url: APPLE_ART }, status: 500, body: '' }]);
		const res = await commitAdd(d, KIND_OF_BLUE);
		expect(res.ok).toBe(true);
		expect(list()[0].artworkPath).toBeNull();
	});

	it('reports provider failures and unknown items without writing anything', async () => {
		const d = deps([{ request: { url: 'https://itunes.apple.com/lookup?id=999&country=us' }, status: 503, body: '' }]);
		expect(await commitAdd(d, { ...KIND_OF_BLUE, id: '999' })).toMatchObject({ ok: false, status: 502 });
		expect(await commitAdd(d, { ...KIND_OF_BLUE, id: '1' })).toMatchObject({ ok: false, status: 404 });
		expect(await commitAdd(deps([], { spotify: false }), { provider: 'spotify', kind: 'album', id: '1weenld61qoidwYuZ1GESA' })).toMatchObject({ ok: false, status: 400 });
		expect(db.select().from(entities).all()).toHaveLength(0);
	});
});

describe('resolveForAdd', () => {
	it('resolves links to a committable ref', async () => {
		expect(await resolveForAdd(deps(), 'https://music.apple.com/us/album/kind-of-blue/268443092', 'album')).toEqual({
			type: 'item',
			ref: KIND_OF_BLUE,
			name: 'Kind of Blue',
			artistName: 'Miles Davis'
		});
	});

	it('refuses artist links with an explanation', async () => {
		const r = await resolveForAdd(deps(), 'https://music.apple.com/us/artist/miles-davis/44984', 'album');
		expect(r).toMatchObject({ type: 'error', message: expect.stringContaining('Miles Davis is an artist') });
	});

	it('searches text across providers, dropping cross-provider duplicates and flagging listed items', async () => {
		const d = deps();
		await commitAdd(d, KIND_OF_BLUE);
		const r = await resolveForAdd(d, 'kind of blue', 'album');
		if (r.type !== 'results') throw new Error(r.type);
		const kob = r.results.filter((x) => x.name.toLowerCase() === 'kind of blue' && x.artistName === 'Miles Davis');
		expect(kob).toHaveLength(1);
		expect(kob[0]).toMatchObject({ provider: 'apple', id: '268443092', inLibrary: true });
		expect(r.results.filter((x) => x.provider === 'spotify').every((x) => !x.inLibrary)).toBe(true);
		expect(r.warnings).toEqual([]);
	});

	it('keeps Apple results when Spotify search fails', async () => {
		const d = deps([{ request: { url: 'https://api.spotify.com/v1/search?q=kind+of+blue&type=album&limit=10' }, status: 500, body: '' }]);
		const r = await resolveForAdd(d, 'kind of blue', 'album');
		expect(r).toMatchObject({ type: 'results', warnings: ['Spotify search failed.'] });
		if (r.type === 'results') expect(r.results.length).toBeGreaterThan(0);
	});
});

describe('listening list', () => {
	it('marks listened (stamping today), rates, reviews, and filters/sorts', async () => {
		const d = deps();
		const a = await commitAdd(d, KIND_OF_BLUE);
		const t = await commitAdd(d, SO_WHAT);
		if (!a.ok || !t.ok) throw new Error('add failed');

		updateListItem(db, a.entityId, { status: 'listened', rating: 9, review: 'Modal perfection.' });
		updateListItem(db, t.entityId, { status: 'listened', rating: 7, listenedAt: '2020-01-01' });

		expect(list()).toHaveLength(0);
		const listened = list({ status: 'listened', sort: 'rating' });
		expect(listened.map((r) => [r.name, r.rating])).toEqual([['Kind of Blue', 9], ['So What', 7]]);
		expect(listened[0].listenedAt).toBe(new Date().toISOString().slice(0, 10));
		expect(listened[0].review).toBe('Modal perfection.');
		expect(list({ status: 'listened', sort: 'listened' }).map((r) => r.name)).toEqual(['Kind of Blue', 'So What']);
		expect(list({ status: 'listened', kind: 'track' }).map((r) => r.name)).toEqual(['So What']);
		expect(list({ status: 'listened', minRating: 8 }).map((r) => r.name)).toEqual(['Kind of Blue']);
		expect(list({ status: 'listened', q: 'miles' })).toHaveLength(2);
		expect(list({ status: 'listened', q: 'kind of' }).map((r) => r.name).sort()).toEqual(['Kind of Blue', 'So What']);
		expect(list({ status: 'listened', q: '100%' })).toHaveLength(0);

		updateListItem(db, a.entityId, { rating: null, review: '   ' });
		expect(list({ status: 'listened' }).find((r) => r.id === a.entityId)).toMatchObject({ rating: null, review: null });
		expect(updateListItem(db, 12345, { rating: 3 })).toBeNull();
	});

	it('removing an item cleans up orphaned stubs but keeps shared parents', async () => {
		const d = deps();
		const t = await commitAdd(d, SO_WHAT);
		if (!t.ok) throw new Error();
		expect(removeFromList(db, t.entityId).deletedEntities).toHaveLength(3); // track, album stub, artist
		expect(db.select().from(entities).all()).toHaveLength(0);

		const a = await commitAdd(d, KIND_OF_BLUE);
		const t2 = await commitAdd(d, SO_WHAT);
		if (!a.ok || !t2.ok) throw new Error();
		expect(removeFromList(db, t2.entityId).deletedEntities).toEqual([t2.entityId]);
		expect(db.select().from(entities).all().map((e) => e.kind).sort()).toEqual(['album', 'artist']);
		expect(removeFromList(db, t2.entityId).removed).toBe(false);
	});

	it('promotes stubs but not artists', async () => {
		const d = deps();
		await commitAdd(d, SO_WHAT);
		const album = db.select().from(entities).all().find((e) => e.kind === 'album')!;
		const artist = db.select().from(entities).all().find((e) => e.kind === 'artist')!;
		expect(promoteToList(db, album.id)).toBe('promoted');
		expect(promoteToList(db, album.id)).toBe('existing');
		expect(promoteToList(db, artist.id)).toBe('not_listable');
		expect(promoteToList(db, 999)).toBe('not_found');
	});
});
