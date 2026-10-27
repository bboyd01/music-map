CREATE TABLE `edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`from_id` integer NOT NULL,
	`to_id` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edges_type_from_to` ON `edges` (`type`,`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `edges_from` ON `edges` (`from_id`);--> statement-breakpoint
CREATE INDEX `edges_to` ON `edges` (`to_id`);