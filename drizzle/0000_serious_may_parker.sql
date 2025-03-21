CREATE TABLE `threads` (
	`guild_id` text NOT NULL,
	`thread_id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`open` integer GENERATED ALWAYS AS (closed_at IS NULL) STORED NOT NULL,
	`title` text,
	`created_at` integer DEFAULT '"2025-03-21T01:46:09.857Z"' NOT NULL,
	`closed_at` integer,
	CONSTRAINT "guild_id_check" CHECK("threads"."guild_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "thread_id_check" CHECK("threads"."thread_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "recipient_id_check" CHECK("threads"."recipient_id" NOT GLOB '*[^0-9]*')
);
