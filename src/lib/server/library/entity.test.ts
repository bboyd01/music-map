import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { entities, listItems } from '../db/schema';
import { setAutoTags } from '../enrich/tags';
import { getEntityView, updateEntity } from './entity';
import { getListWithOptions, ListQuery } from './list';

function setup() {
	const db = openDb(':memory:');
	const artist = db.insert(entities).values({ kind: 'artist', name: 'Miles Davis', normKey: 'a' }).returning().get();
	const album = db.insert(entities).values({ kind: 'album', name: 'Kind of Blue', normKey: 'b', artistId: artist.id, releaseDate: '1959-08-17' }).returning().get();
	const other = db.insert(entities).values({ kind: 'album', name: 'Bitches Brew', normKey: 'c', artistId: artist.id }).returning().get();
	const track = db.insert(entities).values({ kind: 'track', name: 'So What', normKey: 'd', artistId: artist.id, albumId: album.id }).returning().get();
	db.insert(listItems).values([{ entityId: album.id }, { entityId: other.id }, { entityId: track.id }]).run();
	setAutoTags(db, artist.id, 'genre', ['jazz']);
	setAutoTags(db, album.id, 'genre', ['cool jazz']);
	setAutoTags(db, album.id, 'era', ['1950s']);
	setAutoTags(db, other.id, 'genre', ['jazz fusion']);
	setAutoTags(db, other.id, 'era', ['1970s']);
	return { db, artist, album, other, track };
}

describe('entity view and edits', () => {
	it('shows own and inherited tags with where they came from', () => {
		const { db, track } = setup();
		const view = getEntityView(db, track.id)!;
		expect(view).toMatchObject({ name: 'So What', artist: { name: 'Miles Davis' }, album: { name: 'Kind of Blue' } });
		expect(view.tags.genre).toEqual({
			tags: [{ name: 'cool jazz', slug: 'cool-jazz', source: 'auto' }],
			inheritedFrom: { entityId: expect.any(Number), kind: 'album', name: 'Kind of Blue' }
		});
		expect(view.tags.instrument).toEqual({ tags: [], inheritedFrom: null });
	});

	it('overrides inherited tags with manual ones and recomputes artist eras', () => {
		const { db, track, album, artist } = setup();
		const view = updateEntity(db, track.id, { tags: { genre: ['modal jazz'] } });
		expect(view).toMatchObject({ tags: { genre: { tags: [{ name: 'modal jazz', source: 'manual' }], inheritedFrom: null } } });
		updateEntity(db, album.id, { tags: { era: ['1950s', 'Contemporary'] } });
		expect(getEntityView(db, artist.id)!.tags.era.tags.map((t) => t.name).sort()).toEqual(['1950s', '1970s', 'Contemporary']);
	});

	it('edits fields and validates dates', () => {
		const { db, album } = setup();
		expect(updateEntity(db, album.id, { credit: 'Columbia sextet', releaseDate: '1959-08' })).toMatchObject({ credit: 'Columbia sextet', releaseDate: '1959-08' });
		expect(updateEntity(db, album.id, { releaseDate: 'August' })).toBe('invalid_date');
		expect(updateEntity(db, 999, { name: 'x' })).toBeNull();
	});
});

describe('list genre/era filters', () => {
	it('filters on effective tags and lists the options present', () => {
		const { db } = setup();
		const all = getListWithOptions(db, ListQuery.parse({}));
		expect(all.items.find((r) => r.name === 'So What')).toMatchObject({ genres: ['cool jazz'], eras: ['1950s'] });
		expect(all.options.genre.map((o) => [o.name, o.count])).toEqual([['cool jazz', 2], ['jazz fusion', 1]]);
		expect(getListWithOptions(db, ListQuery.parse({ genre: 'cool-jazz' })).items.map((r) => r.name).sort()).toEqual(['Kind of Blue', 'So What']);
		expect(getListWithOptions(db, ListQuery.parse({ era: '1970s' })).items.map((r) => r.name)).toEqual(['Bitches Brew']);
		expect(getListWithOptions(db, ListQuery.parse({ era: '1970s', genre: 'cool-jazz' })).items).toEqual([]);
	});
});
