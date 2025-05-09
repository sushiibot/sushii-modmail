import type { Snowflake } from "discord.js";
import type { runtimeConfig } from "../database/schema";

const DEFAULT_PREFIX = "-";

const DEFAULT_INITIAL_MESSAGE = `
Hello! 👋 Your message has been forwarded to community staff, and we'll get back to you as soon as possible!
To help us assist you faster, please include:

- What you need help with - Be as specific as possible.
- Context - If you're reporting someone, who's involved, screenshots, etc.

The more details you provide, the quicker we can resolve your request!

---

You'll get a ✅ reaction on your messages when they're successfully forwarded to staff.
`;

export class RuntimeConfig {
  public readonly guildId: string;
  public readonly openTagId: string | null;

  // User configurable settings
  protected readonly _prefix: string | null;
  public readonly forumChannelId: string | null;
  public readonly logsChannelId: string | null;
  public readonly requiredRoleIds: Snowflake[];
  protected readonly _initialMessage: string | null;
  public readonly anonymousSnippets: boolean;

  constructor(
    guildId: string,
    openTagId: string | null,
    prefix: string | null,
    forumChannelId: string | null,
    logsChannelId: string | null,
    requiredRoleIds: Snowflake[],
    initialMessage: string | null,
    anonymousSnippets: boolean
  ) {
    this.guildId = guildId;
    this.openTagId = openTagId;
    this._prefix = prefix;
    this.forumChannelId = forumChannelId;
    this.logsChannelId = logsChannelId;
    this.requiredRoleIds = requiredRoleIds;
    this._initialMessage = initialMessage;
    this.anonymousSnippets = anonymousSnippets;
  }

  get prefix(): string {
    return this._prefix ?? DEFAULT_PREFIX;
  }

  get initialMessage(): string {
    return this._initialMessage ?? DEFAULT_INITIAL_MESSAGE;
  }

  /**
   * Create a ConfigModel from the environment ConfigType
   */
  static fromDatabaseRow(
    row: typeof runtimeConfig.$inferSelect
  ): RuntimeConfig {
    const requiredRoleIds = JSON.parse(row.requiredRoleIds);

    if (!Array.isArray(requiredRoleIds)) {
      throw new Error(
        `Invalid requiredRoleIds for guild ${row.guildId}: ${row.requiredRoleIds}`
      );
    }

    return new RuntimeConfig(
      row.guildId,
      row.openTagId,
      row.prefix,
      row.forumChannelId,
      row.logsChannelId,
      requiredRoleIds,
      row.initialMessage,
      row.anonymousSnippets
    );
  }

  static default(guildId: string): RuntimeConfig {
    return new RuntimeConfig(guildId, null, null, null, null, [], null, true);
  }
}
