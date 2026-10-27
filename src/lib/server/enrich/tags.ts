import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { eraVocabulary } from '../../domain/eras';
import { effectiveTags, type EffectiveFacet, type TagRef } from '../../domain/inheritance';
import { cleanTagName, slugify, type Facet } from '../../domain/tags';
import { escapeLike, type DbOrTx } from '../db/client';
import { entities, entityTags, tags } from '../db/schema';

function upsertTag(db: DbOrTx, facet: Facet, rawName: string): number | null {
	const name = cleanTagName(facet, rawName);
	const slug = slugify(name);
	if (!slug) return null;
	const existing = db.select({ id: tags.id }).from(tags).where(and(eq(tags.facet, facet), eq(tags.slug, slug))).get();
	if (existing) return existing.id;
	return db.insert(tags).values({ facet, name, slug }).returning({ id: tags.id }).get().id;
}

/** Inserts the era vocabulary (periods + decades) if missing. */
export function seedEras(db: DbOrTx) {
	for (const name of eraVocabulary()) upsertTag(db, 'era', name);
}

export function tagsFor(db: DbOrTx, entityIds: number[]): Map<number, TagRef[]> {
	const out = new Map<number, TagRef[]>(entityIds.map((id) => [id, []]));
	if (!entityIds.length) return out;
	const rows = db
		.select({ entityId: entityTags.entityId, source: entityTags.source, facet: tags.facet, name: tags.name, slug: tags.slug })
		.from(entityTags)
		.innerJoin(tags, eq(tags.id, entityTags.tagId))
		.where(inArray(entityTags.entityId, entityIds))
		.orderBy(asc(tags.name))
		.all();
	for (const { entityId, ...tag } of rows) out.get(entityId)?.push(tag);
	return out;
}

function facetRows(db: DbOrTx, entityId: number, facet: Facet) {
	return db
		.select({ tagId: entityTags.tagId, source: entityTags.source })
		.from(entityTags)
		.innerJoin(tags, eq(tags.id, entityTags.tagId))
		.where(and(eq(entityTags.entityId, entityId), eq(tags.facet, facet)))
		.all();
}

/** A facet with any manual tag on an entity is owned by the user; enrichment leaves it alone. */
export function hasManual(db: DbOrTx, entityId: number, facet: Facet): boolean {
	return facetRows(db, entityId, facet).some((r) => r.source === 'manual');
}

function insertTags(db: DbOrTx, entityId: number, facet: Facet, names: string[], source: 'auto' | 'manual') {
	for (const name of names) {
		const tagId = upsertTag(db, facet, name);
		if (tagId !== null) db.insert(entityTags).values({ entityId, tagId, source }).onConflictDoNothing().run();
	}
}

/** Replaces an entity's auto tags in a facet, unless the user owns that facet. Idempotent. */
export function setAutoTags(db: DbOrTx, entityId: number, facet: Facet, names: string[]): boolean {
	const rows = facetRows(db, entityId, facet);
	if (rows.some((r) => r.source === 'manual')) return false;
	if (rows.length) {
		db.delete(entityTags)
			.where(and(eq(entityTags.entityId, entityId), inArray(entityTags.tagId, rows.map((r) => r.tagId))))
			.run();
	}
	insertTags(db, entityId, facet, names, 'auto');
	return true;
}

/** Adds auto tags without removing existing ones (e.g. instruments aggregated onto an artist). */
export function addAutoTags(db: DbOrTx, entityId: number, facet: Facet, names: string[]): boolean {
	if (hasManual(db, entityId, facet)) return false;
	insertTags(db, entityId, facet, names, 'auto');
	return true;
}

/** The user's edit: the facet becomes exactly `names`, all manual. Empty → inherit again. */
export function setManualTags(db: DbOrTx, entityId: number, facet: Facet, names: string[]) {
	const rows = facetRows(db, entityId, facet);
	if (rows.length) {
		db.delete(entityTags)
			.where(and(eq(entityTags.entityId, entityId), inArray(entityTags.tagId, rows.map((r) => r.tagId))))
			.run();
	}
	insertTags(db, entityId, facet, names, 'manual');
}

export type Effective = Record<Facet, EffectiveFacet>;

/** Effective (inherited) tags for many entities at once. */
export function effectiveFor(db: DbOrTx, entityIds: number[]): Map<number, Effective> {
	const out = new Map<number, Effective>();
	if (!entityIds.length) return out;
	const rows = db
		.select({ id: entities.id, kind: entities.kind, albumId: entities.albumId, artistId: entities.artistId })
		.from(entities)
		.where(inArray(entities.id, entityIds))
		.all();
	const kinds = new Map<number, (typeof rows)[number]['kind']>(rows.map((r) => [r.id, r.kind]));
	const parentIds = [...new Set(rows.flatMap((r) => [r.albumId, r.artistId]).filter((x): x is number => x !== null))];
	for (const p of parentIds.length
		? db.select({ id: entities.id, kind: entities.kind }).from(entities).where(inArray(entities.id, parentIds)).all()
		: []) {
		kinds.set(p.id, p.kind);
	}
	const all = tagsFor(db, [...new Set([...entityIds, ...parentIds])]);
	for (const r of rows) {
		const chain = [r.id, r.albumId, r.artistId]
			.filter((x): x is number => x !== null && kinds.has(x))
			.map((id) => ({ entityId: id, kind: kinds.get(id)!, tags: all.get(id) ?? [] }));
		out.set(r.id, effectiveTags(chain));
	}
	return out;
}

/** Autocomplete: tags in a facet matching a prefix/substring, most used first. */
export function searchTags(db: DbOrTx, facet: Facet, q: string, limit = 12) {
	const escaped = escapeLike(q);
	const pattern = `%${escaped}%`;
	return db
		.select({ name: tags.name, slug: tags.slug, uses: sql<number>`count(${entityTags.entityId})` })
		.from(tags)
		.leftJoin(entityTags, eq(entityTags.tagId, tags.id))
		.where(and(eq(tags.facet, facet), q ? sql`${tags.name} like ${pattern} escape '\\'` : undefined))
		.groupBy(tags.id)
		.orderBy(sql`${tags.name} like ${escaped + '%'} escape '\\' desc`, sql`count(${entityTags.entityId}) desc`, asc(tags.name))
		.limit(limit)
		.all();
}

