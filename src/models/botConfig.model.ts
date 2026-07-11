import { type ConfigType } from "../config/config";
import type { BotRosterEntry } from "../config/botRegistry";

/**
 * Process-wide settings shared by every bot instance, independent of any
 * one bot's identity.
 */
export type GlobalConfig = Pick<
  ConfigType,
  "LOG_LEVEL" | "DATABASE_URI" | "HEALTHCHECK_PORT" | "GIT_HASH" | "BUILD_DATE"
>;

/**
 * Model representation of application configuration with standard TypeScript casing
 */
export class BotConfig {
  public readonly name: string;
  public readonly logLevel: string;
  public readonly discordToken: string;
  public readonly discordClientId: string;

  public readonly mailGuildId: string;
  public readonly databaseUri: string;
  public readonly healthcheckPort: number;

  public readonly gitHash?: string;
  public readonly buildDate?: Date;

  constructor(
    name: string,
    logLevel: string,
    discordToken: string,
    discordClientId: string,
    databaseUri: string,
    mailGuildId: string,
    healthcheckPort: number,
    gitHash?: string,
    buildDate?: Date
  ) {
    this.name = name;
    this.logLevel = logLevel;
    this.discordToken = discordToken;
    this.discordClientId = discordClientId;
    this.databaseUri = databaseUri;
    this.mailGuildId = mailGuildId;
    this.healthcheckPort = healthcheckPort;
    this.gitHash = gitHash;
    this.buildDate = buildDate;
  }

  /**
   * Create a BotConfig from one BotRosterEntry plus the process-wide
   * globals shared by every bot instance. `applicationId` is resolved
   * from the entry's token via the Discord API (see
   * config/botRegistry.ts's resolveApplicationId) rather than read off
   * the roster entry itself.
   */
  static fromRosterEntry(
    entry: BotRosterEntry,
    applicationId: string,
    globals: GlobalConfig
  ): BotConfig {
    return new BotConfig(
      entry.name,
      globals.LOG_LEVEL,
      entry.discordToken,
      applicationId,
      globals.DATABASE_URI,
      entry.mailGuildId,
      globals.HEALTHCHECK_PORT,
      globals.GIT_HASH,
      globals.BUILD_DATE
    );
  }

  get guildId(): string {
    return this.mailGuildId;
  }
}
