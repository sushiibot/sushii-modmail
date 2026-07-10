import type { DB } from "database/db";
import { botEmojis } from "database/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { BotEmoji, type BotEmojiName } from "models/botEmoji.model";
import { getLogger } from "utils/logger";

export class BotEmojiRepository {
  private db: DB;
  private applicationId: string;

  private logger = getLogger(this.constructor.name);

  constructor(db: DB, applicationId: string) {
    this.db = db;
    this.applicationId = applicationId;
  }

  async getEmoji(name: BotEmojiName): Promise<BotEmoji | null> {
    this.logger.trace({ name }, "Getting emoji");

    const rows = await this.db
      .select()
      .from(botEmojis)
      .where(
        and(
          eq(botEmojis.name, name),
          eq(botEmojis.applicationId, this.applicationId)
        )
      )
      .limit(1)
      .execute();

    if (rows.length === 0) {
      return null;
    }

    return BotEmoji.fromDatabaseRow(rows[0]);
  }

  async getEmojis(names: BotEmojiName[]): Promise<BotEmoji[]> {
    this.logger.trace({ names }, "Getting emojis");

    const rows = await this.db
      .select()
      .from(botEmojis)
      .where(
        and(
          inArray(botEmojis.name, names),
          eq(botEmojis.applicationId, this.applicationId)
        )
      )
      .execute();

    return rows.map((row) => BotEmoji.fromDatabaseRow(row));
  }

  async saveEmoji(name: string, id: string, sha256: string): Promise<BotEmoji> {
    this.logger.debug(
      { name, id, sha256, applicationId: this.applicationId },
      "Saving emoji"
    );

    // An emoji whose content changed gets deleted and re-uploaded to
    // Discord under a *new* id (see BotEmojiService/BotEmojiController's
    // edit flow) -- the old (applicationId, name) row would otherwise
    // still occupy the composite unique index and collide with the new
    // row's insert. Clear it first so the insert below can't hit that
    // stale row.
    await this.db
      .delete(botEmojis)
      .where(
        and(
          eq(botEmojis.applicationId, this.applicationId),
          eq(botEmojis.name, name),
          ne(botEmojis.id, id)
        )
      )
      .execute();

    // Conflict target stays on `id` (the primary key), NOT the composite
    // (applicationId, name) index. `id` is a Discord snowflake and already
    // globally unique, so a conflict on `id` can only mean "this exact
    // emoji record already exists" (created earlier by this bot, or a
    // legacy NULL-owner row this bot is now claiming) -- always safe to
    // update. Targeting the composite index instead would miss the
    // legacy-row case: a NULL-owner row's (applicationId, name) doesn't
    // match (this.applicationId, name), so an insert with this bot's
    // applicationId would collide on `id` and surface a raw UNIQUE
    // constraint error instead of updating.
    const inserted = await this.db
      .insert(botEmojis)
      .values({
        name,
        id,
        sha256,
        applicationId: this.applicationId,
      })
      .onConflictDoUpdate({
        target: [botEmojis.id],
        set: { name, sha256, applicationId: this.applicationId },
      })
      .returning();

    return BotEmoji.fromDatabaseRow(inserted[0]);
  }

  /**
   * Fetches emojis by names and returns a map of name to emoji string, logging any missing entries.
   */
  async getEmojiMap(
    names: readonly BotEmojiName[]
  ): Promise<Record<BotEmojiName, string>> {
    // Convert to non-readonly
    const emojis = await this.getEmojis([...names]);

    const map = {} as Record<BotEmojiName, string>;
    for (const name of names) {
      const found = emojis.find((e) => e.name === name);
      if (!found) {
        this.logger.error({ name }, `Emoji not found in database: ${name}`);
        map[name] = "";
      } else {
        map[name] = found.toEmojiString();
      }
    }

    this.logger.debug({ emojis: map }, "Mapped emojis to strings");
    return map;
  }
}
