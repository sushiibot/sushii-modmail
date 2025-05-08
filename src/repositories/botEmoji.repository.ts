import type { DB } from "database/db";
import { botEmojis } from "database/schema";
import { eq } from "drizzle-orm";
import { BotEmoji, type BotEmojiName } from "models/botEmoji.model";
import { getLogger } from "utils/logger";

export class BotEmojiRepository {
  private db: DB;

  private logger = getLogger(this.constructor.name);

  constructor(db: DB) {
    this.db = db;
  }

  async getEmoji(name: BotEmojiName): Promise<BotEmoji | null> {
    this.logger.debug({ name }, "Getting emoji");

    const rows = await this.db
      .select()
      .from(botEmojis)
      .where(eq(botEmojis.name, name))
      .execute();

    if (rows.length === 0) {
      return null;
    }

    return BotEmoji.fromDatabaseRow(rows[0]);
  }

  async saveEmoji(name: string, id: string, sha256: string): Promise<BotEmoji> {
    this.logger.debug({ name, id, sha256 }, "Saving emoji");

    const inserted = await this.db
      .insert(botEmojis)
      .values({
        name,
        id,
        sha256,
      })
      .onConflictDoUpdate({
        target: [botEmojis.name],
        set: { id, sha256 },
      })
      .returning();
    return BotEmoji.fromDatabaseRow(inserted[0]);
  }
}
