import { type DB } from "../database/db";
import { runtimeConfig } from "../database/schema";
import { eq } from "drizzle-orm";
import { RuntimeConfig } from "../models/runtimeConfig.model";

export class RuntimeConfigRepository {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
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

    return RuntimeConfig.fromDatabaseRow(result[0]);
  }

  async setOpenTagId(
    guildId: string,
    openTagId: string | null
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        openTagId,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { openTagId },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setPrefix(
    guildId: string,
    prefix: string | null
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        prefix,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { prefix },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setForumChannelId(
    guildId: string,
    forumChannelId: string | null
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        forumChannelId,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { forumChannelId },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setLogsChannelId(
    guildId: string,
    logsChannelId: string | null
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        logsChannelId,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { logsChannelId },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setRequiredRoleIds(
    guildId: string,
    requiredRoleIds: string[]
  ): Promise<RuntimeConfig> {
    const requiredRolesStr = JSON.stringify(requiredRoleIds);

    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        requiredRoleIds: requiredRolesStr,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { requiredRoleIds: requiredRolesStr },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setInitialMessage(
    guildId: string,
    initialMessage: string | null
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        initialMessage,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { initialMessage },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }

  async setAnonymousSnippets(
    guildId: string,
    anonymousSnippets: boolean
  ): Promise<RuntimeConfig> {
    const inserted = await this.db
      .insert(runtimeConfig)
      .values({
        guildId,
        anonymousSnippets,
      })
      .onConflictDoUpdate({
        target: [runtimeConfig.guildId],
        set: { anonymousSnippets },
      })
      .returning();

    return RuntimeConfig.fromDatabaseRow(inserted[0]);
  }
}
