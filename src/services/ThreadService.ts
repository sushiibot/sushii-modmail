import { ChannelType, Client, GuildMember } from "discord.js";
import { Thread } from "../models/thread.model";
import { StaffThreadView } from "../views/StaffThreadView";
import { getLogger } from "utils/logger";

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

export class ThreadService {
  private guildId: string;
  private forumChannelId: string;
  private client: Client;
  private threadRepository: ThreadRepository;

  private logger = getLogger("ThreadService");

  constructor(
    guildId: string,
    forumChannelId: string,
    client: Client,
    threadRepository: ThreadRepository
  ) {
    this.guildId = guildId;
    this.forumChannelId = forumChannelId;
    this.client = client;
    this.threadRepository = threadRepository;
  }

  async getOrCreateThread(userId: string, username: string): Promise<Thread> {
    let thread = await this.threadRepository.getOpenThreadByUserID(userId);

    if (!thread) {
      this.logger.debug(`Creating new thread for user ${userId}`);
      thread = await this.createNewThread(userId, username);
    }

    return thread;
  }

  private async createNewThread(
    userId: string,
    username: string
  ): Promise<Thread> {
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) {
      throw new Error(`Guild not found: ${this.guildId}`);
    }

    const modmailForumChannel = await this.client.channels.fetch(
      this.forumChannelId
    );

    if (!modmailForumChannel) {
      throw new Error(
        `Modmail forum channel not found: ${this.forumChannelId}`
      );
    }

    if (modmailForumChannel.type !== ChannelType.GuildForum) {
      throw new Error(`Invalid modmail forum channel: ${this.forumChannelId}`);
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
    // Create Forum thread
    const threadMetadata = StaffThreadView.newThreadMetadata(userId, username);
    const threadInitialMsg = StaffThreadView.initialThreadMessage({
      user: user,
      member: member,
    });

    const newThread = await modmailForumChannel.threads.create({
      name: threadMetadata.name,
      reason: threadMetadata.reason,
      message: threadInitialMsg,
    });

    // -------------------------------------------------------------------------
    // Save to database
    const thread = this.threadRepository.createThread(
      newThread.guildId,
      userId,
      newThread.id
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

    // Lock the forum thread as completed
    await threadChannel.setLocked(true);

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
