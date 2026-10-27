import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { clampRating } from '../../domain/rating';
import { escapeLike, type DbOrTx } from '../db/client';
import { entities, listItems } from '../db/schema';
import { slugify } from '../../domain/tags';
import type { FacetOption, ListRow } from '../../types';
import { effectiveFor } from '../enrich/tags';
import { collectGarbage } from './entities';
import { artistNamesSql } from './relations';


export const ListQuery = z.object({
	status: z.enum(['to_listen', 'listened']).default('to_listen'),
	kind: z.enum(['all', 'album', 'track']).default('all'),
	q: z.string().trim().max(200).default(''),
	sort: z.enum(['added', 'listened', 'rating', 'year']).default('added'),
	/** Minimum rating in half-stars (listened only). */
	minRating: z.coerce.number().int().min(0).max(10).optional(),
	/** Tag slugs; matched against effective (inherited) tags. */
	genre: z.string().max(100).optional(),
	era: z.string().max(100).optional()
});
export type ListQuery = z.infer<typeof ListQuery>;


const artist = alias(entities, 'artist');
const album = alias(entities, 'album');

export function getList(db: DbOrTx, query: ListQuery): ListRow[] {
	return getListWithOptions(db, query).items;
}

/** List rows with effective tags, plus the genre/era options present in this status. */
export function getListWithOptions(
	db: DbOrTx,
	query: ListQuery
): { items: ListRow[]; options: { genre: FacetOption[]; era: FacetOption[] } } {
	const where: SQL[] = [eq(listItems.status, query.status)];
	if (query.kind !== 'all') where.push(eq(entities.kind, query.kind));
	if (query.minRating !== undefined) where.push(sql`${listItems.rating} >= ${query.minRating}`);
	if (query.q) {
		const pattern = `%${escapeLike(query.q)}%`;
		where.push(
			or(
				sql`${entities.name} like ${pattern} escape '\\'`,
				sql`${artistNamesSql(artist.name)} like ${pattern} escape '\\'`,
				sql`${album.name} like ${pattern} escape '\\'`
			)!
		);
	}
	const nullsLast = (col: SQL | typeof listItems.rating) => sql`${col} is null`;
	const order = {
		added: [desc(listItems.addedAt)],
		listened: [nullsLast(sql`${listItems.listenedAt}`), desc(listItems.listenedAt), desc(listItems.addedAt)],
		rating: [nullsLast(listItems.rating), desc(listItems.rating), desc(listItems.listenedAt)],
		year: [nullsLast(sql`${entities.releaseDate}`), desc(entities.releaseDate), asc(entities.name)]
	}[query.sort];

	const rows = db
		.select({
			id: entities.id,
			kind: entities.kind,
			name: entities.name,
			artistName: artistNamesSql(artist.name),
			albumName: album.name,
			releaseDate: entities.releaseDate,
			artworkPath: sql<string | null>`coalesce(${entities.artworkPath}, ${album.artworkPath})`,
			enrichStatus: entities.enrichStatus,
			status: listItems.status,
			rating: listItems.rating,
			review: listItems.review,
			addedAt: listItems.addedAt,
			listenedAt: listItems.listenedAt
		})
		.from(listItems)
		.innerJoin(entities, eq(entities.id, listItems.entityId))
		.leftJoin(artist, eq(artist.id, entities.artistId))
		.leftJoin(album, eq(album.id, entities.albumId))
		.where(and(...where))
		.orderBy(...order, desc(entities.id))
		.all() as Omit<ListRow, 'genres' | 'eras'>[];

	const eff = effectiveFor(db, rows.map((r) => r.id));
	const items: ListRow[] = rows.map((r) => ({
		...r,
		genres: eff.get(r.id)?.genre.tags.map((t) => t.name) ?? [],
		eras: eff.get(r.id)?.era.tags.map((t) => t.name) ?? []
	}));

	const options = { genre: facetOptions(items, 'genres'), era: facetOptions(items, 'eras') };
	const filtered = items.filter(
		(r) =>
			(!query.genre || r.genres.some((g) => slugify(g) === query.genre)) &&
			(!query.era || r.eras.some((e) => slugify(e) === query.era))
	);
	return { items: filtered, options };
}

function facetOptions(items: ListRow[], key: 'genres' | 'eras'): FacetOption[] {
	const counts = new Map<string, FacetOption>();
	for (const item of items) {
		for (const name of item[key]) {
			const slug = slugify(name);
			const o = counts.get(slug) ?? { slug, name, count: 0 };
			o.count++;
			counts.set(slug, o);
		}
	}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const ListPatch = z
	.object({
		status: z.enum(['to_listen', 'listened']),
		rating: z.number().int().min(0).max(10).nullable(),
		review: z.string().max(20_000).nullable(),
		listenedAt: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.nullable()
	})
	.partial()
	.strict();
export type ListPatch = z.infer<typeof ListPatch>;

const today = () => new Date().toISOString().slice(0, 10);

export function listCounts(db: DbOrTx): Record<'to_listen' | 'listened', number> {
	const rows = db
		.select({ status: listItems.status, n: sql<number>`count(*)` })
		.from(listItems)
		.groupBy(listItems.status)
		.all();
	const counts = { to_listen: 0, listened: 0 };
	for (const r of rows) counts[r.status] = r.n;
	return counts;
}

/** Applies a patch to a list item. Marking listened without a date stamps today. */
export function updateListItem(db: DbOrTx, entityId: number, patch: ListPatch) {
	const current = db.select().from(listItems).where(eq(listItems.entityId, entityId)).get();
	if (!current) return null;
	const next: Partial<typeof listItems.$inferInsert> = { ...patch };
	if (patch.rating !== undefined) next.rating = clampRating(patch.rating);
	if (patch.review !== undefined) next.review = patch.review?.trim() ? patch.review : null;
	if (patch.status === 'listened' && patch.listenedAt === undefined && !current.listenedAt) next.listenedAt = today();
	if (Object.keys(next).length === 0) return current;
	return db.update(listItems).set(next).where(eq(listItems.entityId, entityId)).returning().get();
}

/** Adds an existing album/track entity (e.g. a stub) to the list. */
export function promoteToList(db: DbOrTx, entityId: number): 'promoted' | 'existing' | 'not_found' | 'not_listable' {
	const entity = db.select({ kind: entities.kind }).from(entities).where(eq(entities.id, entityId)).get();
	if (!entity) return 'not_found';
	if (entity.kind === 'artist') return 'not_listable';
	const res = db.insert(listItems).values({ entityId, status: 'to_listen' }).onConflictDoNothing().run();
	return res.changes ? 'promoted' : 'existing';
}

/** Removes an item from the list; the entity (and its stub parents) go too if nothing else needs them. */
export function removeFromList(db: DbOrTx, entityId: number): { removed: boolean; deletedEntities: number[] } {
	const res = db.delete(listItems).where(eq(listItems.entityId, entityId)).run();
	if (!res.changes) return { removed: false, deletedEntities: [] };
	return { removed: true, deletedEntities: collectGarbage(db, entityId) };
}

