import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { normKey } from '../../domain/normalize';
import { openDb, type DB } from '../db/client';
import { entities, entityArtists, externalIds, listItems } from '../db/schema';
import { exportLibrary, importLibrary } from '../library/backup';
import { getEntityDetail } from '../library/entity';
import { getList, ListQuery, removeFromList } from '../library/list';
import type { MusicBrainzClient } from '../providers/musicbrainz';
import { createEnrichment } from './runner';

const CREDITS = [
	{ id: 'mb-cory', name: 'Cory Wong', credited: 'Cory Wong' },
	{ id: 'mb-metropole', name: 'Metropole Orkest', credited: 'Metropole Orkest' },
	{ id: 'mb-buckley', name: 'Jules Buckley', credited: 'Jules Buckley' }
];

// Only the calls enrichment makes once the album already has a release-group id.
function fakeMb(artists: typeof CREDITS) {
	return {
		getReleaseGroup: async (id: string) => ({ id, title: 'Live', genres: [], artists, releases: [] }),
		getArtist: async () => null,
		searchArtists: async () => []
	} as unknown as MusicBrainzClient;
}

let db: DB;
beforeEach(() => {
	db = openDb(':memory:');
});

function seed(artistName: string, albumName = 'Live in Amsterdam', rg = 'rg-1') {
	const artist =
		db.select().from(entities).where(eq(entities.normKey, normKey('artist', { name: artistName }))).get() ??
		db.insert(entities).values({ kind: 'artist', name: artistName, normKey: normKey('artist', { name: artistName }) }).returning().get();
	const album = db
		.insert(entities)
		.values({ kind: 'album', name: albumName, normKey: normKey('album', { name: albumName, artistName }), artistId: artist.id })
		.returning()
		.get();
	db.insert(externalIds).values({ entityId: album.id, provider: 'musicbrainz', externalId: rg }).run();
	db.insert(listItems).values({ entityId: album.id }).run();
	return { artist, album };
}

async function enrich(id: number, credits = CREDITS) {
	const e = createEnrichment({ db, mb: fakeMb(credits), providers: { apple: null as never, spotify: null }, artworkDir: '/nonexistent' });
	e.enqueue({ entityId: id });
	await e.worker.drain();
}

const artists = () =>
	db.select({ name: entities.name }).from(entities).where(eq(entities.kind, 'artist')).all().map((a) => a.name).sort();
const listed = () => getList(db, ListQuery.parse({}));

describe('multi-artist credits', () => {
	it('splits a combined artist into the credited artists', async () => {
		const { artist, album } = seed('Cory Wong, Metropole Orkest & Jules Buckley');
		await enrich(album.id);

		expect(artists()).toEqual(['Cory Wong', 'Jules Buckley', 'Metropole Orkest']);
		// The combined entity became the primary artist, keeping its id.
		expect(db.select().from(entities).where(eq(entities.id, artist.id)).get()).toMatchObject({ name: 'Cory Wong', normKey: 'artist|cory wong' });
		expect(listed()[0].artistName).toBe('Cory Wong, Metropole Orkest, Jules Buckley');
		expect(getList(db, ListQuery.parse({ q: 'buckley' }))).toHaveLength(1);

		const metropole = db.select().from(entities).where(eq(entities.name, 'Metropole Orkest')).get()!;
		expect(getEntityDetail(db, metropole.id)!.children.map((c) => c.name)).toEqual(['Live in Amsterdam']);
		expect(getEntityDetail(db, album.id)!.coArtists.map((a) => a.name)).toEqual(['Metropole Orkest', 'Jules Buckley']);
	});

	it('merges into an artist that already exists', async () => {
		const solo = seed('Cory Wong', 'The Optimist', 'rg-solo');
		const { album } = seed('Cory Wong, Metropole Orkest & Jules Buckley');
		await enrich(album.id);

		expect(artists()).toEqual(['Cory Wong', 'Jules Buckley', 'Metropole Orkest']);
		expect(db.select().from(entities).where(eq(entities.id, album.id)).get()!.artistId).toBe(solo.artist.id);
		expect(getEntityDetail(db, solo.artist.id)!.children.map((c) => c.name).sort()).toEqual(['Live in Amsterdam', 'The Optimist']);
	});

	it('adds co-credits without renaming when our artist is one of them', async () => {
		const { album } = seed('Cory Wong');
		await enrich(album.id);
		expect(artists()).toEqual(['Cory Wong', 'Jules Buckley', 'Metropole Orkest']);
		await enrich(album.id); // re-enrichment is idempotent
		expect(db.select().from(entityArtists).all()).toHaveLength(2);
	});

	it('leaves a single credited act alone', async () => {
		const { album } = seed('Earth, Wind & Fire');
		await enrich(album.id, [{ id: 'mb-ewf', name: 'Earth, Wind & Fire', credited: 'Earth, Wind & Fire' }]);
		expect(artists()).toEqual(['Earth, Wind & Fire']);
	});

	it('cleans up co-credited artists with the release, and survives export/import', async () => {
		const { album } = seed('Cory Wong, Metropole Orkest & Jules Buckley');
		await enrich(album.id);

		const file = exportLibrary(db);
		const copy = openDb(':memory:');
		importLibrary(copy, file, '/nonexistent');
		expect(copy.select().from(entityArtists).all()).toHaveLength(2);

		removeFromList(db, album.id);
		expect(artists()).toEqual([]);
	});
});
