import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const threads = sqliteTable(
  "threads",
  {
    // Discord IDs are 64-bit integers, but we store them as strings to avoid
    // precision loss. Discord.js uses strings for IDs anyways.
    guildId: text().notNull(),
    threadId: text().notNull().primaryKey(),
    recipientId: text().notNull(),

    // User metadata
    title: text(),

    createdAt: integer({ mode: "timestamp" }).notNull().default(new Date()),
    closedAt: integer({ mode: "timestamp" }),

    closedBy: text(),
  },
  (table) => [
    // Ensure IDs are numeric
    check("guild_id_check", sql`${table.guildId} NOT GLOB '*[^0-9]*'`),
    check("thread_id_check", sql`${table.threadId} NOT GLOB '*[^0-9]*'`),
    check("recipient_id_check", sql`${table.recipientId} NOT GLOB '*[^0-9]*'`),
    check(
      "closedby_id_check",
      sql`${table.closedBy} IS NULL OR ${table.closedBy} NOT GLOB '*[^0-9]*'`
    ),
  ]
);

export const messages = sqliteTable(
  "messages",
  {
    threadId: text()
      .notNull()
      .references(() => threads.threadId, { onDelete: "cascade" }),
    // This is always the message in the modmail thread
    // Could be staff message (resent) or user message (relayed)
    messageId: text().notNull().primaryKey(),
    authorId: text().notNull(),
    isStaff: integer({ mode: "boolean" }).notNull(),

    // If staff message relayed to user, this is the relayed message in DMs
    staffRelayedMessageId: text(),

    // If user message relayed to staff, this is the ORIGINAL message in DMs
    userDmMessageId: text(),

    // Metadata, mostly useful for re-building the message in staff thread
    // Staff only fields.
    content: text(), // Can be null if attachment only
    forwarded: integer({ mode: "boolean" }).notNull().default(false),

    // Attachments / Stickers
    // Need to save them to edit component v2 images without needing to parse
    // the fields
    attachmentUrls: text().notNull().default("[]"), // JSON string of attachment URLs
    stickers: text().notNull().default("[]"), // JSON string of sticker.name, sticker.url

    // Flags
    isAnonymous: integer({ mode: "boolean" }).default(false),
    isPlainText: integer({ mode: "boolean" }).default(false),
    isSnippet: integer({ mode: "boolean" }).default(false),

    // State
    isDeleted: integer({ mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    // IDs
    check("thread_id_check", sql`${table.threadId} NOT GLOB '*[^0-9]*'`),
    check("message_id_check", sql`${table.messageId} NOT GLOB '*[^0-9]*'`),
    check("author_id_check", sql`${table.authorId} NOT GLOB '*[^0-9]*'`),
    check(
      "dm_message_id_check",
      sql`${table.staffRelayedMessageId} NOT GLOB '*[^0-9]*'`
    ),
    check(
      "user_dm_message_id_check",
      sql`${table.userDmMessageId} NOT GLOB '*[^0-9]*'`
    ),

    // If staff message: Must have relayed message && No user message
    // If user message: Must have no relayed message && Must have user message
    check(
      "message_type_check",
      sql`(
            ${table.isStaff} = 1
            AND ${table.staffRelayedMessageId} IS NOT NULL
            AND ${table.userDmMessageId} IS NULL)
          OR
          (
            ${table.isStaff} = 0
            AND ${table.userDmMessageId} IS NOT NULL
            AND ${table.staffRelayedMessageId} IS NULL
          )`
    ),

    // Metadata
    // If staff, must have all metadata columns
    // If user, content column is optional.
    check(
      "staff_metadata_check",
      sql`
        ${table.isStaff} = 0
        OR
        (
          ${table.isStaff} = 1
          AND ${table.isAnonymous} IS NOT NULL
          AND ${table.isPlainText} IS NOT NULL
          AND ${table.isSnippet} IS NOT NULL
        )`
    ),
  ]
);

export const snippets = sqliteTable(
  "snippets",
  {
    guildId: text().notNull(),
    name: text().notNull(),
    content: text().notNull(),
  },
  (table) => [
    check("guild_id_check", sql`${table.guildId} NOT GLOB '*[^0-9]*'`),
  ]
);

// Configs that can only be set in run-time and need to be persisted
export const runtimeConfig = sqliteTable(
  "config",
  {
    guildId: text().notNull().primaryKey(),
    openTagId: text(),
  },
  (table) => [
    check("guild_id_check", sql`${table.guildId} NOT GLOB '*[^0-9]*'`),
    check("open_tag_id_check", sql`${table.openTagId} NOT GLOB '*[^0-9]*'`),
  ]
);

/*
export const botEmojis = sqliteTable("bot_emojis", {
  name: text().notNull().unique(),
  id: text().notNull().primaryKey(),
});
*/
