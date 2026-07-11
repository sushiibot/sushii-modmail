import { type DB } from "../database/db";
import { runtimeConfig } from "../database/schema";
import { eq, sql } from "drizzle-orm";
import { RuntimeConfig } from "../models/runtimeConfig.model";
import { getLogger } from "utils/logger";
import { recordGuildOwnershipConflict } from "utils/metrics";
import { GuildOwnershipConflictError } from "./errors";

export type UpdateConfig = {
  requiredRoleIds?: string[];
} & Partial<Omit<typeof runtimeConfig.$inferInsert, "requiredRoleIds">>;

export class RuntimeConfigRepository {
  private db: DB;
  private applicationId: string;

  private logger = getLogger(this.constructor.name);

  constructor(db: DB, applicationId: string) {
    this.db = db;
    this.applicationId = applicationId;
  }

  /**
   * Throws GuildOwnershipConflictError if the row is owned by a different,
   * non-null applicationId than this repository's own.
   */
  private assertOwnership(
    guildId: string,
    rowApplicationId: string | null
  ): void {
    if (
      rowApplicationId !== null &&
      rowApplicationId !== this.applicationId
    ) {
      recordGuildOwnershipConflict(rowApplicationId);
      throw new GuildOwnershipConflictError(
        guildId,
        this.applicationId,
        rowApplicationId
      );
    }
  }

  async getConfig(guildId: string): Promise<RuntimeConfig> {
    const result = await this.db
      .select()
      .from(runtimeConfig)
      .where(eq(runtimeConfig.guildId, guildId))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return RuntimeConfig.default(guildId);
    }

    this.assertOwnership(guildId, result[0].applicationId);

    return RuntimeConfig.fromDatabaseRow(result[0]);
  }

  async setConfig(
    guildId: string,
    changes: UpdateConfig
  ): Promise<RuntimeConfig> {
    await this.assertWritable(guildId);

    // Filter out any undefined values
    const toSet: Omit<typeof runtimeConfig.$inferInsert, "guildId"> =
      Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined)
      );

    if (changes.requiredRoleIds !== undefined) {
      toSet.requiredRoleIds = JSON.stringify(changes.requiredRoleIds);
    }

    toSet.applicationId = this.applicationId;

    this.logger.debug(
      {
        guildId,
        changes,
        toSet,
      },
      "Setting runtime config"
    );

    const inserted = await this.db
      .insert(runtimeConfig)
      .values({ guildId, ...toSet })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: toSet,
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async toggleAnonymousSnippets(guildId: string): Promise<RuntimeConfig> {
    await this.assertWritable(guildId);

    const rows = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        applicationId: this.applicationId,
        // Opposite of default
        anonymousSnippets: !RuntimeConfig.default(guildId).anonymousSnippets,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: {
          anonymousSnippets: sql`NOT ${runtimeConfig.anonymousSnippets}`,
          applicationId: this.applicationId,
        },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(rows[0]);
  }

  /**
   * Read-then-check before any write: throws GuildOwnershipConflictError
   * without writing if the existing row belongs to a different bot. Not
   * atomic/concurrency-safe -- acceptable since only one bot's repository
   * instance is ever expected to write to a given guild's row by
   * construction (the roster's mailGuildId-uniqueness check); this is a
   * backstop for when that assumption is violated, not concurrency control.
   */
  private async assertWritable(guildId: string): Promise<void> {
    const result = await this.db
      .select({ applicationId: runtimeConfig.applicationId })
      .from(runtimeConfig)
      .where(eq(runtimeConfig.guildId, guildId))
      .limit(1)
      .execute();

    if (result.length > 0) {
      this.assertOwnership(guildId, result[0].applicationId);
    }
  }
}
