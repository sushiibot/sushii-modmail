PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bots` (
	`application_id` text PRIMARY KEY NOT NULL,
	`discord_token` text NOT NULL,
	`name` text NOT NULL,
	`mail_guild_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	CONSTRAINT "mail_guild_id_check" CHECK(length("__new_bots"."mail_guild_id") > 0 AND "__new_bots"."mail_guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "application_id_check" CHECK(length("__new_bots"."application_id") > 0 AND "__new_bots"."application_id" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
INSERT INTO `__new_bots`("application_id", "discord_token", "name", "mail_guild_id", "created_at") SELECT "application_id", "discord_token", "name", "mail_guild_id", "created_at" FROM `bots`;--> statement-breakpoint
DROP TABLE `bots`;--> statement-breakpoint
ALTER TABLE `__new_bots` RENAME TO `bots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `bots_discord_token_idx` ON `bots` (`discord_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_guild_id_idx` ON `bots` (`mail_guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_name_idx` ON `bots` (lower("name"));--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`guild_id` text NOT NULL,
	`thread_id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT '"2026-08-09T19:49:38.862Z"' NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	CONSTRAINT "guild_id_check" CHECK("__new_threads"."guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "thread_id_check" CHECK("__new_threads"."thread_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "recipient_id_check" CHECK("__new_threads"."recipient_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "closedby_id_check" CHECK("__new_threads"."closed_by" IS NULL OR "__new_threads"."closed_by" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
INSERT INTO `__new_threads`("guild_id", "thread_id", "recipient_id", "title", "created_at", "closed_at", "closed_by") SELECT "guild_id", "thread_id", "recipient_id", "title", "created_at", "closed_at", "closed_by" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;