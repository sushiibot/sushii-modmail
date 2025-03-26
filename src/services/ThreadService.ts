import {
  ChannelType,
  Client,
  DiscordAPIError,
  ForumChannel,
  GuildChannel,
  GuildMember,
  RESTJSONErrorCodes,
  type GuildForumTagData,
} from "discord.js";
import { Thread } from "../models/thread.model";
import { StaffThreadView } from "../views/StaffThreadView";
import { getLogger } from "utils/logger";
import type { RuntimeConfig } from "models/runtimeConfig.model";

interface Config {
  guildId: string;
  forumChannelId: string;
}

interface ThreadRepository {
  getOpenThreadByUserID(userId: string): Promise<Thread | null>;
  getThreadByChannelId(channelId: string): Promise<Thread | null>;
  getAllThreadsByUserId(userId: string): Promise<Thread[]>;
  createThread(
    guildId: string,
    userId: string,
    channelId: string
  ): Promise<Thread>;
  closeThread(channelId: string, userId: string): Promise<void>;
}

interface RuntimeConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig | null>;
  setOpenTagId(
    guildId: string,
    openTagId: string | null
  ): Promise<RuntimeConfig>;
}

export class ThreadService {
  private config: Config;

  private client: Client;
  private threadRepository: ThreadRepository;
  private runtimeConfigRepository: RuntimeConfigRepository;

  private logger = getLogger("ThreadService");

  constructor(
    config: Config,
    client: Client,
    threadRepository: ThreadRepository,
    runtimeConfigRepository: RuntimeConfigRepository
  ) {
    this.config = config;
    this.client = client;
    this.threadRepository = threadRepository;
    this.runtimeConfigRepository = runtimeConfigRepository;
  }

  async getOpenTagId(): Promise<string | null> {
    const runtimeConfig = await this.runtimeConfigRepository.getConfig(
      this.config.guildId
    );

    if (!runtimeConfig) {
      return null;
    }

    return runtimeConfig.openTagId;
  }

  async createOpenTag(forumChannel: ForumChannel): Promise<string> {
    const currentTags: GuildForumTagData[] = forumChannel.availableTags;

    const tagName = "Open";

    // Add the open tag to the list of available tags
    currentTags.push({
      moderated: false,
      name: tagName,
      emoji: {
        id: null,
        name: "📨",
      },
    });

    // Set the available tags
    forumChannel = await forumChannel.setAvailableTags(currentTags);

    // Re-fetch tags to get the new tag ID
    const openTag = forumChannel.availableTags.find(
      (tag) => tag.name === tagName
    );

    if (!openTag) {
      throw new Error("Open tag not found after creation");
    }

    // Save the open tag ID to the runtime config
    await this.runtimeConfigRepository.setOpenTagId(
      this.config.guildId,
      openTag.id
    );

    return openTag.id;
  }

  async getOrCreateThread(
    userId: string,
    username: string
  ): Promise<{ thread: Thread; isNew: boolean }> {
    let thread = await this.threadRepository.getOpenThreadByUserID(userId);
    const isNew = !thread;

    if (!thread) {
      this.logger.debug(`Creating new thread for user ${userId}`);
      thread = await this.createNewThread(userId, username);
    }

    return { thread, isNew };
  }

  async getMutualServers(
    userId: string
  ): Promise<{ id: string; name: string }[]> {
    // This is NOT efficient with many servers.
    // Bot is designed to be in only the 1-2 servers, e.g. main and appeals server
    const mutualGuilds = [];

    for (const guild of this.client.guilds.cache.values()) {
      // Fetch member - throws if not found
      try {
        await guild.members.fetch(userId);
      } catch (err) {
        if (
          err instanceof DiscordAPIError &&
          err.code === RESTJSONErrorCodes.UnknownMember
        ) {
          // Not found member, continue
          continue;
        }

        // Unexpected error
        throw err;
      }

      mutualGuilds.push(guild);
    }

    return mutualGuilds.map((g) => ({ id: g.id, name: g.name }));
  }

  private async createNewThread(
    userId: string,
    username: string
  ): Promise<Thread> {
    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (!guild) {
      throw new Error(`Guild not found: ${this.config.guildId}`);
    }

    const modmailForumChannel = await this.client.channels.fetch(
      this.config.forumChannelId
    );

    if (!modmailForumChannel) {
      throw new Error(
        `Modmail forum channel not found: ${this.config.forumChannelId}`
      );
    }

    if (modmailForumChannel.type !== ChannelType.GuildForum) {
      throw new Error(
        `Invalid modmail forum channel: ${this.config.forumChannelId}`
      );
    }

    // -------------------------------------------------------------------------
    // Get recipient

    let member: GuildMember | null = null;
    try {
      member = await guild.members.fetch(userId);
    } catch (err) {
      // Fine if the member is not found
    }
    const user = await this.client.users.fetch(userId);

    // -------------------------------------------------------------------------
    // Check open tag
    let openTagID = await this.getOpenTagId();
    if (!openTagID) {
      openTagID = await this.createOpenTag(modmailForumChannel);
    }

    // -------------------------------------------------------------------------
    // Get user metadata, previous threads and mutual servers
    const previousThreads = await this.threadRepository.getAllThreadsByUserId(
      userId
    );

    const mutualServers = await this.getMutualServers(userId);

    // -------------------------------------------------------------------------
    // Create Forum thread

    const threadMetadata = StaffThreadView.newThreadMetadata(userId, username);
    const threadInitialMsg = StaffThreadView.initialThreadMessage({
      user: user,
      member: member,
      previousThreads: previousThreads,
      mutualGuilds: mutualServers,
    });

    const discordThread = await modmailForumChannel.threads.create({
      name: threadMetadata.name,
      reason: threadMetadata.reason,
      message: threadInitialMsg,
      appliedTags: [openTagID],
    });

    // -------------------------------------------------------------------------
    // Save to database
    const thread = this.threadRepository.createThread(
      discordThread.guildId,
      userId,
      discordThread.id
    );

    this.logger.debug(thread, `Created new thread`);

    return thread;
  }

  async closeThread(thread: Thread, userId: string): Promise<void> {
    const threadChannel = await this.client.channels.fetch(thread.channelId);
    if (!threadChannel) {
      throw new Error(`Thread channel not found: ${thread.channelId}`);
    }

    if (!threadChannel.isThread()) {
      throw new Error(`Not thread: ${thread.channelId}`);
    }

    this.logger.debug(`Locking and closing thread: ${thread.channelId}`);

    // Send closed message
    await threadChannel.send("Thread closed.");

    // Lock and close the forum thread as completed
    await threadChannel.edit({
      archived: true,
      locked: true,

      // Clear tags, removing open tag -- TODO: Preserve non-Open tags if people
      // use custom tags
      appliedTags: [],
    });

    // Mark as closed in db
    await this.threadRepository.closeThread(thread.channelId, userId);
  }

  /**
   * Get a thread by its Discord channel ID
   * @param channelId The Discord channel ID of the thread
   * @returns The thread information or null if not found
   */
  async getThreadByChannelId(channelId: string): Promise<Thread | null> {
    return this.threadRepository.getThreadByChannelId(channelId);
  }

  /**
   * Get all threads created by a specific user
   * @param userId The Discord user ID
   * @returns Array of threads created by the user
   */
  async getAllThreadsByUserId(userId: string): Promise<Thread[]> {
    return this.threadRepository.getAllThreadsByUserId(userId);
  }
}
