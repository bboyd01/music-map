import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { buildGraph, LAYERS, type EffectiveTagMap, type Graph, type Layer } from '../../domain/graph';
import type { Facet } from '../../domain/tags';
import type { DbOrTx } from '../db/client';
import { edges, entities } from '../db/schema';
import { effectiveFor } from '../enrich/tags';
import { listedSql } from './relations';

const csv = (allowed: readonly string[]) =>
	z
		.string()
		.transform((s) => s.split(',').filter((x) => allowed.includes(x)))
		.optional();

export const GraphQuery = z.object({
	kind: z.enum(['artist', 'album', 'track']).default('artist'),
	layers: csv(LAYERS).transform((l) => (l ?? ['inspired', 'similar', 'genre']) as Layer[]),
	/** `facet:slug`, e.g. `genre:cool-jazz`. */
	tag: z
		.string()
		.regex(/^(genre|era|instrument):[a-z0-9-]+$/)
		.transform((t) => {
			const [facet, slug] = t.split(':');
			return { facet: facet as Facet, slug };
		})
		.optional(),
	focus: z.coerce.number().int().positive().optional(),
	depth: z.coerce.number().int().min(1).max(3).default(2),
	suggested: z
		.enum(['0', '1'])
		.transform((v) => v === '1')
		.default(false)
});
export type GraphQuery = z.infer<typeof GraphQuery>;

const album = alias(entities, 'album');
const artist = alias(entities, 'artist');

/** Loads one kind of entity with its edges and effective tags, and builds the map. */
export function getGraph(db: DbOrTx, q: GraphQuery): Graph {
	const rows = db
		.select({
			id: entities.id,
			name: entities.name,
			kind: entities.kind,
			artistName: artist.name,
			artworkPath: sql<string | null>`coalesce(${entities.artworkPath}, ${album.artworkPath})`,
			listed: listedSql
		})
		.from(entities)
		.leftJoin(artist, eq(artist.id, entities.artistId))
		.leftJoin(album, eq(album.id, entities.albumId))
		.where(eq(entities.kind, q.kind))
		.all()
		.map((r) => ({ ...r, listed: Boolean(r.listed) }));

	const ids = rows.map((r) => r.id);
	const stored =
		ids.length && (q.layers.includes('inspired') || q.layers.includes('similar'))
			? db
					.select({ id: edges.id, type: edges.type, fromId: edges.fromId, toId: edges.toId, status: edges.status })
					.from(edges)
					.where(and(inArray(edges.fromId, ids), inArray(edges.toId, ids)))
					.all()
			: [];

	const tags: EffectiveTagMap = new Map();
	if (q.tag || q.layers.some((l) => l === 'genre' || l === 'era' || l === 'instrument')) {
		for (const [id, eff] of effectiveFor(db, ids)) {
			tags.set(id, { genre: eff.genre.tags, era: eff.era.tags, instrument: eff.instrument.tags });
		}
	}

	return buildGraph(rows, stored, tags, q);
}

