import { and, eq, or, sql } from 'drizzle-orm';
import { canonicalEdge } from '../../domain/edges';
import type { DB } from '../db/client';
import { edges, entities, entityArtists, entityTags, externalIds, listItems, tags } from '../db/schema';

const STATUS_RANK = { rejected: 0, suggested: 1, accepted: 2 } as const;

export type MergeResult = { ok: true; id: number } | { ok: false; status: 400 | 404; message: string };

/**
 * Merges `sourceId` into `targetId` (same kind) and deletes the source: external ids, list item
 * (target's values win, gaps filled from the source), tags (per facet, only where the target has
 * none), edges (re-pointed, deduped, self-links dropped) and child entities all move over.
 */
export function mergeEntities(db: DB, sourceId: number, targetId: number): MergeResult {
	if (sourceId === targetId) return { ok: false, status: 400, message: 'Pick a different item to merge into.' };
	return db.transaction((tx) => {
		const source = tx.select().from(entities).where(eq(entities.id, sourceId)).get();
		const target = tx.select().from(entities).where(eq(entities.id, targetId)).get();
		if (!source || !target) return { ok: false, status: 404, message: 'Item not found.' };
		if (source.kind !== target.kind) return { ok: false, status: 400, message: `Only ${source.kind}s can be merged with ${source.kind}s.` };

		tx.update(externalIds).set({ entityId: targetId }).where(eq(externalIds.entityId, sourceId)).run();

		const srcItem = tx.select().from(listItems).where(eq(listItems.entityId, sourceId)).get();
		const tgtItem = tx.select().from(listItems).where(eq(listItems.entityId, targetId)).get();
		if (srcItem && !tgtItem) {
			tx.update(listItems).set({ entityId: targetId }).where(eq(listItems.entityId, sourceId)).run();
		} else if (srcItem && tgtItem) {
			tx.update(listItems)
				.set({
					status: tgtItem.status === 'listened' || srcItem.status === 'listened' ? 'listened' : 'to_listen',
					rating: tgtItem.rating ?? srcItem.rating,
					review: tgtItem.review ?? srcItem.review,
					listenedAt: tgtItem.listenedAt ?? srcItem.listenedAt,
					addedAt: tgtItem.addedAt < srcItem.addedAt ? tgtItem.addedAt : srcItem.addedAt
				})
				.where(eq(listItems.entityId, targetId))
				.run();
		}

		const tagRows = (id: number) =>
			tx
				.select({ tagId: entityTags.tagId, source: entityTags.source, facet: tags.facet })
				.from(entityTags)
				.innerJoin(tags, eq(tags.id, entityTags.tagId))
				.where(eq(entityTags.entityId, id))
				.all();
		const targetFacets = new Set(tagRows(targetId).map((t) => t.facet));
		for (const t of tagRows(sourceId)) {
			if (targetFacets.has(t.facet)) continue;
			tx.insert(entityTags).values({ entityId: targetId, tagId: t.tagId, source: t.source }).onConflictDoNothing().run();
		}

		for (const e of tx.select().from(edges).where(or(eq(edges.fromId, sourceId), eq(edges.toId, sourceId))).all()) {
			const swap = (id: number) => (id === sourceId ? targetId : id);
			const ends = canonicalEdge(e.type, swap(e.fromId), swap(e.toId));
			const clash = ends
				? tx
						.select()
						.from(edges)
						.where(and(eq(edges.type, e.type), eq(edges.fromId, ends.from), eq(edges.toId, ends.to)))
						.get()
				: undefined;
			if (!ends || clash) {
				if (clash && STATUS_RANK[e.status] > STATUS_RANK[clash.status]) {
					tx.update(edges).set({ status: e.status, source: e.source, note: clash.note ?? e.note }).where(eq(edges.id, clash.id)).run();
				}
				tx.delete(edges).where(eq(edges.id, e.id)).run();
			} else {
				tx.update(edges).set({ fromId: ends.from, toId: ends.to }).where(eq(edges.id, e.id)).run();
			}
		}

		tx.update(entities).set({ artistId: targetId }).where(eq(entities.artistId, sourceId)).run();
		for (const col of [entityArtists.entityId, entityArtists.artistId]) {
			for (const row of tx.select().from(entityArtists).where(eq(col, sourceId)).all()) {
				const moved = { entityId: row.entityId === sourceId ? targetId : row.entityId, artistId: row.artistId === sourceId ? targetId : row.artistId };
				tx.insert(entityArtists).values(moved).onConflictDoNothing().run();
			}
		}
		tx.update(entities).set({ albumId: targetId }).where(eq(entities.albumId, sourceId)).run();

		tx.update(entities)
			.set({
				artworkPath: target.artworkPath ?? source.artworkPath,
				releaseDate: target.releaseDate ?? source.releaseDate,
				durationMs: target.durationMs ?? source.durationMs,
				credit: target.credit ?? source.credit,
				artistId: target.artistId ?? (source.artistId === targetId ? null : source.artistId),
				albumId: target.albumId ?? (source.albumId === targetId ? null : source.albumId),
				updatedAt: new Date().toISOString()
			})
			.where(eq(entities.id, targetId))
			.run();
		tx.delete(entities).where(eq(entities.id, sourceId)).run();
		// A co-credit that now duplicates the primary artist is redundant.
		tx.delete(entityArtists)
			.where(sql`${entityArtists.artistId} = (select artist_id from entities where id = ${entityArtists.entityId})`)
			.run();
		return { ok: true, id: targetId };
	});
}
