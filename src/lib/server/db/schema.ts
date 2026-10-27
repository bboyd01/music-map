import { sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const entities = sqliteTable(
	'entities',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind', { enum: ['artist', 'album', 'track'] }).notNull(),
		name: text('name').notNull(),
		artistId: integer('artist_id').references((): AnySQLiteColumn => entities.id, { onDelete: 'set null' }),
		albumId: integer('album_id').references((): AnySQLiteColumn => entities.id, { onDelete: 'set null' }),
		credit: text('credit'),
		/** ISO, possibly partial: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
		releaseDate: text('release_date'),
		durationMs: integer('duration_ms'),
		/** File name inside DATA_DIR/artwork. */
		artworkPath: text('artwork_path'),
		normKey: text('norm_key').notNull(),
		enrichStatus: text('enrich_status', { enum: ['pending', 'running', 'done', 'failed'] })
			.notNull()
			.default('pending'),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => [index('entities_norm_key').on(t.normKey), index('entities_kind_artist').on(t.kind, t.artistId)]
);

export const externalIds = sqliteTable(
	'external_ids',
	{
		entityId: integer('entity_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		provider: text('provider', { enum: ['apple', 'spotify', 'musicbrainz', 'wikidata'] }).notNull(),
		externalId: text('external_id').notNull(),
		url: text('url')
	},
	(t) => [
		uniqueIndex('external_ids_provider_id').on(t.provider, t.externalId),
		index('external_ids_entity').on(t.entityId)
	]
);

export const listItems = sqliteTable(
	'listen_items',
	{
		entityId: integer('entity_id')
			.primaryKey()
			.references(() => entities.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['to_listen', 'listened'] }).notNull().default('to_listen'),
		/** 0–10 half-stars; null = unrated. */
		rating: integer('rating'),
		review: text('review'),
		addedAt: text('added_at').notNull().default(now),
		listenedAt: text('listened_at')
	},
	(t) => [index('listen_items_status').on(t.status)]
);

export const tags = sqliteTable(
	'tags',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		facet: text('facet', { enum: ['genre', 'era', 'instrument'] }).notNull(),
		name: text('name').notNull(),
		slug: text('slug').notNull()
	},
	(t) => [uniqueIndex('tags_facet_slug').on(t.facet, t.slug)]
);

export const entityTags = sqliteTable(
	'entity_tags',
	{
		entityId: integer('entity_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tags.id, { onDelete: 'cascade' }),
		source: text('source', { enum: ['auto', 'manual'] }).notNull()
	},
	(t) => [primaryKey({ columns: [t.entityId, t.tagId] }), index('entity_tags_tag').on(t.tagId)]
);

/** Only `inspired` and `similar` are stored; genre/era/instrument links are derived from tags. */
export const edges = sqliteTable(
	'edges',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		type: text('type', { enum: ['inspired', 'similar'] }).notNull(),
		/** inspired: the influence. similar: the lower id. */
		fromId: integer('from_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		toId: integer('to_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['accepted', 'suggested', 'rejected'] }).notNull(),
		source: text('source', { enum: ['manual', 'musicbrainz', 'wikidata', 'lastfm'] }).notNull(),
		note: text('note'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => [
		uniqueIndex('edges_type_from_to').on(t.type, t.fromId, t.toId),
		index('edges_from').on(t.fromId),
		index('edges_to').on(t.toId)
	]
);

export const jobs = sqliteTable(
	'jobs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		type: text('type', { enum: ['enrich', 'suggest', 'artwork'] }).notNull(),
		payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
		status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
		attempts: integer('attempts').notNull().default(0),
		runAfter: text('run_after').notNull().default(now),
		lastError: text('last_error'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => [index('jobs_status_run_after').on(t.status, t.runAfter)]
);

export const sessions = sqliteTable('sessions', {
	idHash: text('id_hash').primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull()
});

export const kv = sqliteTable('kv', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export type Entity = typeof entities.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Edge = typeof edges.$inferSelect;
