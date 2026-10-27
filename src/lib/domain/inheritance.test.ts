import { describe, expect, it } from 'vitest';
import { ancestorIds, effectiveTags, type Level, type TagRef } from './inheritance';

const tag = (facet: TagRef['facet'], name: string, source: TagRef['source'] = 'auto'): TagRef => ({ facet, name, slug: name, source });

describe('effectiveTags', () => {
	const artist: Level = { entityId: 1, kind: 'artist', tags: [tag('genre', 'jazz'), tag('era', '1950s'), tag('instrument', 'trumpet')] };
	const album: Level = { entityId: 2, kind: 'album', tags: [tag('genre', 'cool jazz'), tag('era', '1950s')] };
	const track: Level = { entityId: 3, kind: 'track', tags: [tag('instrument', 'piano', 'manual')] };

	it('uses own tags per facet, else the nearest ancestor', () => {
		const eff = effectiveTags([track, album, artist]);
		expect(eff.instrument).toEqual({ tags: [tag('instrument', 'piano', 'manual')], inheritedFrom: null });
		expect(eff.genre).toEqual({ tags: [tag('genre', 'cool jazz')], inheritedFrom: { entityId: 2, kind: 'album' } });
		expect(eff.era.inheritedFrom).toEqual({ entityId: 2, kind: 'album' });
	});

	it('skips levels with nothing in a facet', () => {
		const eff = effectiveTags([{ ...track, tags: [] }, { ...album, tags: [] }, artist]);
		expect(eff.genre).toEqual({ tags: [tag('genre', 'jazz')], inheritedFrom: { entityId: 1, kind: 'artist' } });
	});

	it('own tags override even when an ancestor has more', () => {
		expect(effectiveTags([album, artist]).genre.tags.map((t) => t.name)).toEqual(['cool jazz']);
	});

	it('returns empty facets when nobody has tags', () => {
		expect(effectiveTags([{ entityId: 9, kind: 'album', tags: [] }]).genre).toEqual({ tags: [], inheritedFrom: null });
	});

	it('builds the ancestor chain', () => {
		expect(ancestorIds({ id: 3, albumId: 2, artistId: 1 })).toEqual([3, 2, 1]);
		expect(ancestorIds({ id: 2, albumId: null, artistId: 1 })).toEqual([2, 1]);
	});
});
