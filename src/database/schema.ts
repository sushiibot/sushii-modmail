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
    check("closedby_id_check", sql`${table.closedBy} NOT GLOB '*[^0-9]*'`),
  ]
);
