import type { Facet } from './tags';

export interface TagRef {
	facet: Facet;
	name: string;
	slug: string;
	source: 'auto' | 'manual';
}

export interface Level {
	entityId: number;
	kind: 'artist' | 'album' | 'track';
	tags: TagRef[];
}

export interface EffectiveFacet {
	tags: TagRef[];
	/** The ancestor these came from, or null if they're the entity's own. */
	inheritedFrom: { entityId: number; kind: Level['kind'] } | null;
}

/**
 * Effective tags per facet (section 6.1): the entity's own tags in a facet if it has any,
 * otherwise those of the nearest ancestor that has some. `chain` is [self, album?, artist?].
 */
export function effectiveTags(chain: Level[]): Record<Facet, EffectiveFacet> {
	const result = {} as Record<Facet, EffectiveFacet>;
	for (const facet of ['genre', 'era', 'instrument'] as Facet[]) {
		result[facet] = { tags: [], inheritedFrom: null };
		for (const [i, level] of chain.entries()) {
			const tags = level.tags.filter((t) => t.facet === facet);
			if (tags.length) {
				result[facet] = { tags, inheritedFrom: i === 0 ? null : { entityId: level.entityId, kind: level.kind } };
				break;
			}
		}
	}
	return result;
}

/** Ancestor chain for an entity, nearest first: track → album → artist. */
export function ancestorIds(e: { id: number; albumId: number | null; artistId: number | null }): number[] {
	return [e.id, e.albumId, e.artistId].filter((x): x is number => x !== null);
}
