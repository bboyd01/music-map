import { sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	index,
	integer,
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
export type ListItem = typeof listItems.$inferSelect;
