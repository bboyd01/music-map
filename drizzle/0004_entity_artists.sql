CREATE TABLE `entity_artists` (
	`entity_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	PRIMARY KEY(`entity_id`, `artist_id`),
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_artists_artist` ON `entity_artists` (`artist_id`);