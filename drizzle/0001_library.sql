CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`artist_id` integer,
	`album_id` integer,
	`credit` text,
	`release_date` text,
	`duration_ms` integer,
	`artwork_path` text,
	`norm_key` text NOT NULL,
	`enrich_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`album_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entities_norm_key` ON `entities` (`norm_key`);--> statement-breakpoint
CREATE INDEX `entities_kind_artist` ON `entities` (`kind`,`artist_id`);--> statement-breakpoint
CREATE TABLE `external_ids` (
	`entity_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_ids_provider_id` ON `external_ids` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_ids_entity` ON `external_ids` (`entity_id`);--> statement-breakpoint
CREATE TABLE `listen_items` (
	`entity_id` integer PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'to_listen' NOT NULL,
	`rating` integer,
	`review` text,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`listened_at` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listen_items_status` ON `listen_items` (`status`);