PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`thread_id` text NOT NULL,
	`message_id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`is_staff` integer NOT NULL,
	`staff_relayed_message_id` text,
	`user_dm_message_id` text,
	`content` text,
	`forwarded` integer DEFAULT false NOT NULL,
	`attachment_urls` text DEFAULT '[]' NOT NULL,
	`stickers` text DEFAULT '[]' NOT NULL,
	`is_anonymous` integer DEFAULT false,
	`is_plain_text` integer DEFAULT false,
	`is_snippet` integer DEFAULT false,
	`is_deleted` integer DEFAULT false NOT NULL,
	`dm_failed` integer,
	`edited_by_id` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`thread_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_id_check" CHECK("__new_messages"."thread_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "message_id_check" CHECK("__new_messages"."message_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "author_id_check" CHECK("__new_messages"."author_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "dm_message_id_check" CHECK("__new_messages"."staff_relayed_message_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "user_dm_message_id_check" CHECK("__new_messages"."user_dm_message_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "message_type_check" CHECK((
            "__new_messages"."is_staff" = 1
            AND ("__new_messages"."staff_relayed_message_id" IS NOT NULL OR "__new_messages"."dm_failed" = 1)
            AND "__new_messages"."user_dm_message_id" IS NULL)
          OR
          (
            "__new_messages"."is_staff" = 0
            AND "__new_messages"."user_dm_message_id" IS NOT NULL
            AND "__new_messages"."staff_relayed_message_id" IS NULL
          )),
	CONSTRAINT "staff_metadata_check" CHECK(
        "__new_messages"."is_staff" = 0
        OR
        (
          "__new_messages"."is_staff" = 1
          AND "__new_messages"."is_anonymous" IS NOT NULL
          AND "__new_messages"."is_plain_text" IS NOT NULL
          AND "__new_messages"."is_snippet" IS NOT NULL
        ))
);
--> statement-breakpoint
INSERT INTO `__new_messages`("thread_id", "message_id", "author_id", "is_staff", "staff_relayed_message_id", "user_dm_message_id", "content", "forwarded", "attachment_urls", "stickers", "is_anonymous", "is_plain_text", "is_snippet", "is_deleted", "dm_failed", "edited_by_id") SELECT "thread_id", "message_id", "author_id", "is_staff", "staff_relayed_message_id", "user_dm_message_id", "content", "forwarded", "attachment_urls", "stickers", "is_anonymous", "is_plain_text", "is_snippet", "is_deleted", "dm_failed", "edited_by_id" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;