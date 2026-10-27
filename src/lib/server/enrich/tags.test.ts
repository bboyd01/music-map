import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { entities } from '../db/schema';
import { addAutoTags, effectiveFor, searchTags, seedEras, setAutoTags, setManualTags, tagsFor } from './tags';

function setup() {
	const db = openDb(':memory:');
	const artist = db.insert(entities).values({ kind: 'artist', name: 'Miles Davis', normKey: 'a' }).returning().get();
	const album = db.insert(entities).values({ kind: 'album', name: 'Kind of Blue', normKey: 'b', artistId: artist.id }).returning().get();
	const track = db.insert(entities).values({ kind: 'track', name: 'So What', normKey: 'c', artistId: artist.id, albumId: album.id }).returning().get();
	return { db, artist, album, track };
}
const names = (db: ReturnType<typeof setup>['db'], id: number, facet: string) =>
	tagsFor(db, [id]).get(id)!.filter((t) => t.facet === facet).map((t) => `${t.name}:${t.source}`);

describe('tag storage', () => {
	it('replaces auto tags idempotently and dedupes by slug', () => {
		const { db, album } = setup();
		setAutoTags(db, album.id, 'genre', ['Jazz', 'cool jazz']);
		setAutoTags(db, album.id, 'genre', ['jazz', 'Modal Jazz', 'modal-jazz']);
		expect(names(db, album.id, 'genre')).toEqual(['jazz:auto', 'modal jazz:auto']);
	});

	it('never overwrites manual tags during re-enrichment', () => {
		const { db, album } = setup();
		setAutoTags(db, album.id, 'genre', ['jazz']);
		setManualTags(db, album.id, 'genre', ['jazz', 'west coast']);
		expect(setAutoTags(db, album.id, 'genre', ['rock'])).toBe(false);
		expect(addAutoTags(db, album.id, 'genre', ['pop'])).toBe(false);
		expect(names(db, album.id, 'genre')).toEqual(['jazz:manual', 'west coast:manual']);
		// other facets are still enriched
		setAutoTags(db, album.id, 'era', ['1950s']);
		expect(names(db, album.id, 'era')).toEqual(['1950s:auto']);
	});

	it('clearing manual tags hands the facet back to inheritance and enrichment', () => {
		const { db, album } = setup();
		setManualTags(db, album.id, 'genre', ['jazz']);
		setManualTags(db, album.id, 'genre', []);
		expect(setAutoTags(db, album.id, 'genre', ['jazz'])).toBe(true);
	});

	it('computes effective tags through the hierarchy', () => {
		const { db, artist, album, track } = setup();
		setAutoTags(db, artist.id, 'instrument', ['trumpet']);
		setAutoTags(db, album.id, 'genre', ['cool jazz']);
		setAutoTags(db, album.id, 'era', ['1950s']);
		setManualTags(db, track.id, 'instrument', ['piano']);
		const eff = effectiveFor(db, [track.id, album.id]);
		expect(eff.get(track.id)!.genre).toMatchObject({ tags: [{ name: 'cool jazz' }], inheritedFrom: { kind: 'album' } });
		expect(eff.get(track.id)!.instrument).toMatchObject({ tags: [{ name: 'piano', source: 'manual' }], inheritedFrom: null });
		expect(eff.get(album.id)!.instrument).toMatchObject({ tags: [{ name: 'trumpet' }], inheritedFrom: { kind: 'artist' } });
	});

	it('seeds eras and autocompletes, prefix matches first', () => {
		const { db, album } = setup();
		seedEras(db);
		seedEras(db);
		expect(searchTags(db, 'era', 'baro').map((t) => t.name)).toEqual(['Baroque']);
		setAutoTags(db, album.id, 'genre', ['hard bop', 'bop', 'bossa nova']);
		expect(searchTags(db, 'genre', 'bo').map((t) => t.name)).toEqual(['bop', 'bossa nova', 'hard bop']);
		expect(searchTags(db, 'genre', '%')).toEqual([]);
	});
});
