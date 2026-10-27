import { and, eq, or } from 'drizzle-orm';
import type { DbOrTx as DB } from '../db/client';
import { entities, externalIds, listItems, type Entity } from '../db/schema';

type Provider = (typeof externalIds.$inferInsert)['provider'];
type Kind = Entity['kind'];

interface EntityInput {
	kind: Kind;
	name: string;
	normKey: string;
	external?: { provider: Provider; id: string; url?: string };
	artistId?: number | null;
	albumId?: number | null;
	releaseDate?: string | null;
	durationMs?: number | null;
}

function findByExternalId(db: DB, provider: Provider, externalId: string): Entity | undefined {
	return db
		.select({ e: entities })
		.from(externalIds)
		.innerJoin(entities, eq(entities.id, externalIds.entityId))
		.where(and(eq(externalIds.provider, provider), eq(externalIds.externalId, externalId)))
		.get()?.e;
}

function findByNormKey(db: DB, kind: Kind, normKey: string): Entity | undefined {
	return db
		.select()
		.from(entities)
		.where(and(eq(entities.kind, kind), eq(entities.normKey, normKey)))
		.orderBy(entities.id)
		.get();
}

function attachExternalId(db: DB, entityId: number, ext: NonNullable<EntityInput['external']>): boolean {
	const res = db
		.insert(externalIds)
		.values({ entityId, provider: ext.provider, externalId: ext.id, url: ext.url })
		.onConflictDoNothing()
		.run();
	return res.changes > 0;
}

/**
 * Finds an entity by external id, then by norm key; otherwise creates it. Missing fields on an
 * existing entity are filled in, never overwritten.
 */
export function ensureEntity(db: DB, input: EntityInput): { entity: Entity; created: boolean; attached: boolean } {
	const existing =
		(input.external && findByExternalId(db, input.external.provider, input.external.id)) ||
		findByNormKey(db, input.kind, input.normKey);

	if (existing) {
		const attached = input.external ? attachExternalId(db, existing.id, input.external) : false;
		const fill: Partial<Entity> = {};
		if (existing.artistId == null && input.artistId != null) fill.artistId = input.artistId;
		if (existing.albumId == null && input.albumId != null) fill.albumId = input.albumId;
		if (!existing.releaseDate && input.releaseDate) fill.releaseDate = input.releaseDate;
		if (existing.durationMs == null && input.durationMs != null) fill.durationMs = input.durationMs;
		if (Object.keys(fill).length) {
			db.update(entities).set({ ...fill, updatedAt: new Date().toISOString() }).where(eq(entities.id, existing.id)).run();
		}
		return { entity: { ...existing, ...fill }, created: false, attached };
	}

	const entity = db
		.insert(entities)
		.values({
			kind: input.kind,
			name: input.name,
			normKey: input.normKey,
			artistId: input.artistId ?? null,
			albumId: input.albumId ?? null,
			releaseDate: input.releaseDate ?? null,
			durationMs: input.durationMs ?? null
		})
		.returning()
		.get();
	if (input.external) attachExternalId(db, entity.id, input.external);
	return { entity, created: true, attached: Boolean(input.external) };
}

/** True if anything still needs this entity (a list item or child entities). */
function isReferenced(db: DB, id: number): boolean {
	if (db.select({ id: listItems.entityId }).from(listItems).where(eq(listItems.entityId, id)).get()) return true;
	const child = db
		.select({ id: entities.id })
		.from(entities)
		.where(or(eq(entities.artistId, id), eq(entities.albumId, id)))
		.get();
	return Boolean(child);
}

/**
 * Deletes an entity if nothing references it, then does the same for its album and artist.
 * Returns the ids that were deleted.
 */
export function collectGarbage(db: DB, id: number): number[] {
	const deleted: number[] = [];
	const queue = [id];
	while (queue.length) {
		const current = queue.shift()!;
		const row = db.select().from(entities).where(eq(entities.id, current)).get();
		if (!row || isReferenced(db, current)) continue;
		db.delete(entities).where(eq(entities.id, current)).run();
		deleted.push(current);
		for (const parent of [row.albumId, row.artistId]) if (parent != null) queue.push(parent);
	}
	return deleted;
}
