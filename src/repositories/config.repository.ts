import { type DB } from "../database/db";
import { runtimeConfig } from "../database/schema";
import { eq } from "drizzle-orm";
import { RuntimeConfig } from "../models/runtimeConfig.model";

export class RuntimeConfigRepository {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async getConfig(guildId: string): Promise<RuntimeConfig | null> {
    const result = await this.db
      .select()
      .from(runtimeConfig)
      .where(eq(runtimeConfig.guildId, guildId))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return RuntimeConfig.fromDatabaseRow(result[0]);
  }

  async setOpenTagId(
    guildId: string,
    openTagId: string | null
  ): Promise<RuntimeConfig> {
    // Try to update first
    const updated = await this.db
      .update(runtimeConfig)
      .set({ openTagId })
      .where(eq(runtimeConfig.guildId, guildId))
      .returning();

    // If no rows were updated, insert a new record
    if (updated.length === 0) {
      const inserted = await this.db
        .insert(runtimeConfig)
        .values({
          guildId,
          openTagId,
        })
        .returning();

      return RuntimeConfig.fromDatabaseRow(inserted[0]);
    }

    return RuntimeConfig.fromDatabaseRow(updated[0]);
  }
}
