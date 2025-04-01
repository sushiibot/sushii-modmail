import { type ConfigType } from "../config/config";

const defaultInitialMessage = `
Hello! 👋 Your message has been forwarded to community staff, and we'll get back to you as soon as possible!
To help us assist you faster, please include:

- What you need help with - Be as specific as possible.
- Context - If you're reporting someone, who's involved, screenshots, etc.

The more details you provide, the quicker we can resolve your request!

---

You'll get a ✅ reaction on your messages when they're successfully forwarded to staff.
`;

/**
 * Model representation of application configuration with standard TypeScript casing
 */
export class BotConfig {
  public readonly logLevel: string;
  public readonly discordToken: string;
  public readonly discordClientId: string;

  public readonly mailGuildId: string;
  public readonly forumChannelId: string;
  public readonly logsChannelId: string;

  public readonly databaseUri: string;

  // Runtime configuration
  public readonly prefix: string;
  public readonly initialMessage: string;
  public readonly anonymousSnippets: boolean;

  constructor(
    logLevel: string,
    discordToken: string,
    discordClientId: string,
    mailGuildId: string,
    forumChannelId: string,
    logsChannelId: string,
    databaseUri: string,
    prefix: string | undefined = "-",
    initialMessage: string | undefined = defaultInitialMessage,
    anonymousSnippets: boolean | undefined = false
  ) {
    this.logLevel = logLevel;
    this.discordToken = discordToken;
    this.discordClientId = discordClientId;
    this.mailGuildId = mailGuildId;
    this.forumChannelId = forumChannelId;
    this.logsChannelId = logsChannelId;
    this.databaseUri = databaseUri;
    this.prefix = prefix;
    this.initialMessage = initialMessage;
    this.anonymousSnippets = anonymousSnippets;
  }

  /**
   * Create a ConfigModel from the environment ConfigType
   */
  static fromConfigType(config: ConfigType): BotConfig {
    return new BotConfig(
      config.LOG_LEVEL,
      config.DISCORD_TOKEN,
      config.DISCORD_CLIENT_ID,
      config.MAIL_GUILD_ID,
      config.FORUM_CHANNEL_ID,
      config.LOGS_CHANNEL_ID,
      config.DATABASE_URI,
      config.PREFIX,
      config.INITIAL_MESSAGE,
      config.ANONYMOUS_SNIPPETS
    );
  }

  get guildId(): string {
    return this.mailGuildId;
  }
}
