import { type ConfigType } from "../config/config";

/**
 * Model representation of application configuration with standard TypeScript casing
 */
export class BotConfig {
  public readonly logLevel: string;
  public readonly discordToken: string;
  public readonly discordClientId: string;

  public readonly mailGuildId: string;
  public readonly databaseUri: string;

  constructor(
    logLevel: string,
    discordToken: string,
    discordClientId: string,
    databaseUri: string,
    mailGuildId: string
  ) {
    this.logLevel = logLevel;
    this.discordToken = discordToken;
    this.discordClientId = discordClientId;
    this.databaseUri = databaseUri;
    this.mailGuildId = mailGuildId;
  }

  /**
   * Create a ConfigModel from the environment ConfigType
   */
  static fromConfigType(config: ConfigType): BotConfig {
    return new BotConfig(
      config.LOG_LEVEL,
      config.DISCORD_TOKEN,
      config.DISCORD_CLIENT_ID,
      config.DATABASE_URI,
      config.MAIL_GUILD_ID
    );
  }

  get guildId(): string {
    return this.mailGuildId;
  }
}
