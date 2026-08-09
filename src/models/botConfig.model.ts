import { type ConfigType } from "../config/config";
import type { BotRosterEntry } from "../repositories/bot.repository";

/**
 * Process-wide settings shared by every bot instance, independent of any
 * one bot's identity.
 */
export type GlobalConfig = Pick<
  ConfigType,
  | "LOG_LEVEL"
  | "DATABASE_URI"
  | "HEALTHCHECK_PORT"
  | "GIT_HASH"
  | "BUILD_DATE"
  | "OWNER_USER_ID"
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
  public readonly ownerUserId?: string;

  constructor(
    name: string,
    logLevel: string,
    discordToken: string,
    discordClientId: string,
    databaseUri: string,
    mailGuildId: string,
    healthcheckPort: number,
    gitHash?: string,
    buildDate?: Date,
    ownerUserId?: string
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
    this.ownerUserId = ownerUserId;
  }

  /**
   * Create a BotConfig from one persisted bot roster entry (application id
   * already resolved and stored -- see repositories/bot.repository.ts)
   * plus the process-wide globals shared by every bot instance.
   */
  static fromRosterEntry(entry: BotRosterEntry, globals: GlobalConfig): BotConfig {
    return new BotConfig(
      entry.name,
      globals.LOG_LEVEL,
      entry.discordToken,
      entry.applicationId,
      globals.DATABASE_URI,
      entry.mailGuildId,
      globals.HEALTHCHECK_PORT,
      globals.GIT_HASH,
      globals.BUILD_DATE,
      globals.OWNER_USER_ID
    );
  }

  get guildId(): string {
    return this.mailGuildId;
  }
}
