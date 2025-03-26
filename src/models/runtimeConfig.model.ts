import type { runtimeConfig } from "../database/schema";

export class RuntimeConfig {
  public readonly guildId: string;
  public readonly openTagId: string | null;

  constructor(guildId: string, openTagId: string | null) {
    this.guildId = guildId;
    this.openTagId = openTagId;
  }

  /**
   * Create a ConfigModel from the environment ConfigType
   */
  static fromDatabaseRow(
    row: typeof runtimeConfig.$inferSelect
  ): RuntimeConfig {
    return new RuntimeConfig(row.guildId, row.openTagId);
  }
}
