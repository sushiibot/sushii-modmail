PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_snippets` (
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`pinned_position` integer,
	CONSTRAINT "guild_id_check" CHECK("__new_snippets"."guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "pinned_position_check" CHECK("__new_snippets"."pinned_position" IS NULL OR "__new_snippets"."pinned_position" BETWEEN 1 AND 4)
);
--> statement-breakpoint
INSERT INTO `__new_snippets`("guild_id", "name", "content") SELECT "guild_id", "name", "content" FROM `snippets`;--> statement-breakpoint
DROP TABLE `snippets`;--> statement-breakpoint
ALTER TABLE `__new_snippets` RENAME TO `snippets`;--> statement-breakpoint
CREATE UNIQUE INDEX `snippets_pinned_position_idx` ON `snippets` (`guild_id`,`pinned_position`);--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`guild_id` text NOT NULL,
	`thread_id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`toolbar_message_id` text,
	CONSTRAINT "guild_id_check" CHECK("__new_threads"."guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "thread_id_check" CHECK("__new_threads"."thread_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "recipient_id_check" CHECK("__new_threads"."recipient_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "closedby_id_check" CHECK("__new_threads"."closed_by" IS NULL OR "__new_threads"."closed_by" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "toolbar_message_id_check" CHECK("__new_threads"."toolbar_message_id" IS NULL OR "__new_threads"."toolbar_message_id" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
INSERT INTO `__new_threads`("guild_id", "thread_id", "recipient_id", "title", "created_at", "closed_at", "closed_by") SELECT "guild_id", "thread_id", "recipient_id", "title", "created_at", "closed_at", "closed_by" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;