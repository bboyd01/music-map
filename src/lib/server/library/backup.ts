import fs from 'node:fs';
import path from 'node:path';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalEdge } from '../../domain/edges';
import type { DB, DbOrTx } from '../db/client';
import { edges, entities, entityTags, externalIds, kv, listItems, tags } from '../db/schema';
import { upsertTag } from '../enrich/tags';

export const SCHEMA_VERSION = 1;

const Kind = z.enum(['artist', 'album', 'track']);
const ExportedEntity = z.object({
	id: z.number().int(),
	kind: Kind,
	name: z.string().min(1),
	normKey: z.string().min(1),
	artistId: z.number().int().nullable(),
	albumId: z.number().int().nullable(),
	credit: z.string().nullable(),
	releaseDate: z.string().nullable(),
	durationMs: z.number().int().nullable(),
	artworkPath: z.string().nullable(),
	externalIds: z.array(z.object({ provider: z.enum(['apple', 'spotify', 'musicbrainz', 'wikidata']), id: z.string(), url: z.string().nullable() })),
	tags: z.array(z.object({ facet: z.enum(['genre', 'era', 'instrument']), name: z.string().min(1), source: z.enum(['auto', 'manual']) })),
	listItem: z
		.object({
			status: z.enum(['to_listen', 'listened']),
			rating: z.number().int().min(0).max(10).nullable(),
			review: z.string().nullable(),
			addedAt: z.string(),
			listenedAt: z.string().nullable()
		})
		.nullable()
});

export const ExportFile = z.object({
	schemaVersion: z.literal(SCHEMA_VERSION),
	exportedAt: z.string(),
	entities: z.array(ExportedEntity),
	edges: z.array(
		z.object({
			type: z.enum(['inspired', 'similar']),
			from: z.number().int(),
			to: z.number().int(),
			status: z.enum(['accepted', 'suggested', 'rejected']),
			source: z.enum(['manual', 'musicbrainz', 'wikidata', 'lastfm']),
			note: z.string().nullable(),
			createdAt: z.string()
		})
	),
	/** Remembered suggestion rejections (see enrich/suggestions.ts). */
	rejections: z.array(z.string().startsWith('rejected:'))
});
export type ExportFile = z.infer<typeof ExportFile>;

/** The whole library as one JSON document. */
export function exportLibrary(db: DbOrTx): ExportFile {
	const ids = new Map<number, ExportFile['entities'][number]['externalIds']>();
	for (const x of db.select().from(externalIds).all()) {
		ids.set(x.entityId, [...(ids.get(x.entityId) ?? []), { provider: x.provider, id: x.externalId, url: x.url }]);
	}
	const tagRows = new Map<number, ExportFile['entities'][number]['tags']>();
	for (const t of db
		.select({ entityId: entityTags.entityId, source: entityTags.source, facet: tags.facet, name: tags.name })
		.from(entityTags)
		.innerJoin(tags, eq(tags.id, entityTags.tagId))
		.all()) {
		tagRows.set(t.entityId, [...(tagRows.get(t.entityId) ?? []), { facet: t.facet, name: t.name, source: t.source }]);
	}
	const items = new Map(db.select().from(listItems).all().map((l) => [l.entityId, l]));
	return {
		schemaVersion: SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		entities: db
			.select()
			.from(entities)
			.orderBy(entities.id)
			.all()
			.map((e) => {
				const l = items.get(e.id);
				return {
					id: e.id,
					kind: e.kind,
					name: e.name,
					normKey: e.normKey,
					artistId: e.artistId,
					albumId: e.albumId,
					credit: e.credit,
					releaseDate: e.releaseDate,
					durationMs: e.durationMs,
					artworkPath: e.artworkPath,
					externalIds: ids.get(e.id) ?? [],
					tags: tagRows.get(e.id) ?? [],
					listItem: l ? { status: l.status, rating: l.rating, review: l.review, addedAt: l.addedAt, listenedAt: l.listenedAt } : null
				};
			}),
		edges: db
			.select()
			.from(edges)
			.orderBy(edges.id)
			.all()
			.map((e) => ({ type: e.type, from: e.fromId, to: e.toId, status: e.status, source: e.source, note: e.note, createdAt: e.createdAt })),
		rejections: db
			.select({ key: kv.key })
			.from(kv)
			.where(like(kv.key, 'rejected:%'))
			.all()
			.map((r) => r.key)
	};
}

export type ImportResult =
	| { ok: true; created: number; matched: number; edgesAdded: number; listItemsAdded: number }
	| { ok: false; message: string };

/** Validates an uploaded file, with a clear message for unknown versions. */
export function parseExport(raw: unknown): { ok: true; data: ExportFile } | { ok: false; message: string } {
	const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
	if (version === undefined) return { ok: false, message: 'Not a Music Map export (no schemaVersion).' };
	if (version !== SCHEMA_VERSION) {
		return { ok: false, message: `Unsupported export version ${JSON.stringify(version)}; this app reads version ${SCHEMA_VERSION}.` };
	}
	const parsed = ExportFile.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, message: `Invalid export file at ${issue.path.join('.') || '(root)'}: ${issue.message}` };
	}
	return { ok: true, data: parsed.data };
}

const KIND_ORDER = { artist: 0, album: 1, track: 2 } as const;

/**
 * Merges an export into this library. Entities are matched by external id, then by kind + norm
 * key; local values win and gaps are filled. Running the same import twice changes nothing.
 */
export function importLibrary(db: DB, data: ExportFile, artworkDir: string): ImportResult {
	return db.transaction((tx) => {
		const idMap = new Map<number, number>();
		let created = 0;
		let matched = 0;
		let listItemsAdded = 0;

		for (const e of [...data.entities].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id)) {
			const local =
				e.externalIds
					.map(
						(x) =>
							tx
								.select({ e: entities })
								.from(externalIds)
								.innerJoin(entities, eq(entities.id, externalIds.entityId))
								.where(and(eq(externalIds.provider, x.provider), eq(externalIds.externalId, x.id)))
								.get()?.e
					)
					.find((x) => x?.kind === e.kind) ??
				tx.select().from(entities).where(and(eq(entities.kind, e.kind), eq(entities.normKey, e.normKey))).get();

			const artistId = e.artistId === null ? null : (idMap.get(e.artistId) ?? null);
			const albumId = e.albumId === null ? null : (idMap.get(e.albumId) ?? null);
			const artwork = e.artworkPath && fs.existsSync(path.join(artworkDir, path.basename(e.artworkPath))) ? e.artworkPath : null;

			let id: number;
			if (local) {
				matched++;
				id = local.id;
				tx.update(entities)
					.set({
						artistId: local.artistId ?? artistId,
						albumId: local.albumId ?? albumId,
						credit: local.credit ?? e.credit,
						releaseDate: local.releaseDate ?? e.releaseDate,
						durationMs: local.durationMs ?? e.durationMs,
						artworkPath: local.artworkPath ?? artwork
					})
					.where(eq(entities.id, id))
					.run();
			} else {
				created++;
				id = tx
					.insert(entities)
					.values({
						kind: e.kind,
						name: e.name,
						normKey: e.normKey,
						artistId,
						albumId,
						credit: e.credit,
						releaseDate: e.releaseDate,
						durationMs: e.durationMs,
						artworkPath: artwork,
						enrichStatus: 'done'
					})
					.returning({ id: entities.id })
					.get().id;
			}
			idMap.set(e.id, id);

			for (const x of e.externalIds) {
				tx.insert(externalIds).values({ entityId: id, provider: x.provider, externalId: x.id, url: x.url }).onConflictDoNothing().run();
			}
			for (const t of e.tags) {
				const tagId = upsertTag(tx, t.facet, t.name);
				if (tagId !== null) tx.insert(entityTags).values({ entityId: id, tagId, source: t.source }).onConflictDoNothing().run();
			}
			if (e.listItem) {
				const res = tx.insert(listItems).values({ entityId: id, ...e.listItem }).onConflictDoNothing().run();
				listItemsAdded += res.changes;
			}
		}

		let edgesAdded = 0;
		for (const e of data.edges) {
			const from = idMap.get(e.from);
			const to = idMap.get(e.to);
			const ends = from !== undefined && to !== undefined ? canonicalEdge(e.type, from, to) : null;
			if (!ends) continue;
			const res = tx
				.insert(edges)
				.values({ type: e.type, fromId: ends.from, toId: ends.to, status: e.status, source: e.source, note: e.note, createdAt: e.createdAt })
				.onConflictDoNothing()
				.run();
			edgesAdded += res.changes;
		}
		for (const key of data.rejections) {
			tx.insert(kv).values({ key, value: data.exportedAt }).onConflictDoNothing().run();
		}
		return { ok: true, created, matched, edgesAdded, listItemsAdded };
	});
}
