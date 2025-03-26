CREATE TABLE `snippets` (
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "guild_id_check" CHECK("snippets"."guild_id" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`guild_id` text NOT NULL,
	`thread_id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT '"2025-03-25T04:12:23.023Z"' NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	CONSTRAINT "guild_id_check" CHECK("threads"."guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "thread_id_check" CHECK("threads"."thread_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "recipient_id_check" CHECK("threads"."recipient_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "closedby_id_check" CHECK("threads"."closed_by" NOT GLOB '*[^0-9]*')
);
