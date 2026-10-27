import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeReleaseDate } from '../../domain/normalize';
import { FACETS } from '../../domain/tags';
import { groupRelations } from '../../domain/edges';
import type { EntityDetail, EntityView, Facet } from '../../types';
import type { DbOrTx } from '../db/client';
import { edges, entities, entityArtists, externalIds, listItems } from '../db/schema';
import { recomputeArtistEras } from '../enrich/pipeline';
import { effectiveFor, setManualTags } from '../enrich/tags';
import { summaries } from './relations';

export function getEntityView(db: DbOrTx, id: number): EntityView | null {
	const e = db.select().from(entities).where(eq(entities.id, id)).get();
	if (!e) return null;
	const parentIds = [e.artistId, e.albumId].filter((x): x is number => x !== null);
	const parents = parentIds.length
		? db.select({ id: entities.id, name: entities.name }).from(entities).where(inArray(entities.id, parentIds)).all()
		: [];
	const nameOf = (pid: number | null) => parents.find((p) => p.id === pid)?.name;
	const eff = effectiveFor(db, [id]).get(id)!;
	const tags = {} as EntityView['tags'];
	for (const facet of FACETS) {
		const f = eff[facet];
		tags[facet] = {
			tags: f.tags.map(({ name, slug, source }) => ({ name, slug, source })),
			inheritedFrom: f.inheritedFrom ? { ...f.inheritedFrom, name: nameOf(f.inheritedFrom.entityId) ?? '' } : null
		};
	}
	return {
		id: e.id,
		kind: e.kind,
		name: e.name,
		credit: e.credit,
		releaseDate: e.releaseDate,
		artworkPath: e.artworkPath,
		enrichStatus: e.enrichStatus,
		artist: e.artistId !== null ? { id: e.artistId, name: nameOf(e.artistId) ?? '' } : null,
		album: e.albumId !== null ? { id: e.albumId, name: nameOf(e.albumId) ?? '' } : null,
		coArtists: db
			.select({ id: entities.id, name: entities.name })
			.from(entityArtists)
			.innerJoin(entities, eq(entities.id, entityArtists.artistId))
			.where(eq(entityArtists.entityId, id))
			.orderBy(sql`${entityArtists}.rowid`)
			.all(),
		externalIds: db
			.select({ provider: externalIds.provider, id: externalIds.externalId, url: externalIds.url })
			.from(externalIds)
			.where(eq(externalIds.entityId, id))
			.all(),
		tags
	};
}

const TagNames = z.array(z.string().trim().min(1).max(60)).max(30);

export const EntityPatch = z
	.object({
		name: z.string().trim().min(1).max(300),
		credit: z.string().trim().max(300).nullable(),
		releaseDate: z.string().trim().max(20).nullable(),
		tags: z.object({ genre: TagNames, era: TagNames, instrument: TagNames }).partial()
	})
	.partial()
	.strict();
export type EntityPatch = z.infer<typeof EntityPatch>;

/** Applies user edits. Tag edits make that facet manual (never touched by re-enrichment). */
export function updateEntity(db: DbOrTx, id: number, patch: EntityPatch): EntityView | null | 'invalid_date' {
	const e = db.select().from(entities).where(eq(entities.id, id)).get();
	if (!e) return null;
	const fields: Partial<typeof entities.$inferInsert> = {};
	if (patch.name !== undefined) fields.name = patch.name;
	if (patch.credit !== undefined) fields.credit = patch.credit || null;
	if (patch.releaseDate !== undefined) {
		const date = patch.releaseDate ? normalizeReleaseDate(patch.releaseDate) : null;
		if (patch.releaseDate && !date) return 'invalid_date';
		fields.releaseDate = date ?? null;
	}
	if (Object.keys(fields).length) {
		db.update(entities).set({ ...fields, updatedAt: new Date().toISOString() }).where(eq(entities.id, id)).run();
	}
	for (const [facet, names] of Object.entries(patch.tags ?? {}) as [Facet, string[]][]) {
		setManualTags(db, id, facet, names);
	}
	// Artist eras are derived from their releases.
	if (patch.tags?.era && e.kind !== 'artist' && e.artistId !== null) recomputeArtistEras(db, e.artistId);
	return getEntityView(db, id);
}

/** Everything the detail page shows: tags, list state, accepted relations, child releases. */
export function getEntityDetail(db: DbOrTx, id: number): EntityDetail | null {
	const view = getEntityView(db, id);
	if (!view) return null;
	const item = db.select().from(listItems).where(eq(listItems.entityId, id)).get();
	const accepted = db
		.select()
		.from(edges)
		.where(and(or(eq(edges.fromId, id), eq(edges.toId, id)), eq(edges.status, 'accepted')))
		.orderBy(edges.createdAt)
		.all();
	const grouped = groupRelations(id, accepted);
	const childIds = db
		.select({ id: entities.id })
		.from(entities)
		.where(
			view.kind === 'artist'
				? or(eq(entities.artistId, id), sql`${entities.id} in (select entity_id from entity_artists where artist_id = ${id})`)
				: view.kind === 'album'
					? eq(entities.albumId, id)
					: sql`0`
		)
		.orderBy(desc(entities.releaseDate), entities.name)
		.limit(100)
		.all()
		.map((c) => c.id);
	const info = summaries(db, [...accepted.map((e) => (e.fromId === id ? e.toId : e.fromId)), ...childIds]);
	const rel = (list: typeof grouped.inspired) =>
		list.flatMap((e) => {
			const entity = info.get(e.otherId);
			return entity ? [{ edgeId: e.id, note: e.note, source: e.source, entity }] : [];
		});
	return {
		...view,
		listItem: item
			? { status: item.status, rating: item.rating, review: item.review, addedAt: item.addedAt, listenedAt: item.listenedAt }
			: null,
		relations: { inspiredBy: rel(grouped.inspiredBy), inspired: rel(grouped.inspired), similar: rel(grouped.similar) },
		children: childIds.map((c) => info.get(c)!).filter(Boolean)
	};
}
