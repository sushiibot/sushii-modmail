import { ChannelType, Client } from "discord.js";
import { ThreadRepository } from "../repositories/thread.repository";
import { Thread } from "../models/thread.model";
import { StaffThreadView } from "../views/StaffThreadView";
import { getLogger } from "utils/logger";

export class ThreadService {
  private threadRepository: ThreadRepository;
  private logger = getLogger("ThreadService");

  constructor(threadRepository: ThreadRepository) {
    this.threadRepository = threadRepository;
  }

  async getOrCreateThread(
    client: Client,
    userId: string,
    username: string
  ): Promise<Thread> {
    let thread = await this.threadRepository.getOpenThreadByUserID(userId);

    if (!thread) {
      thread = await this.createNewThread(client, userId, username);
    }

    return thread;
  }

  private async createNewThread(
    client: Client,
    userId: string,
    username: string
  ): Promise<Thread> {
    const modmailForumChannel = await client.channels.fetch(
      process.env.MODMAIL_FORUM_ID!
    );

    if (!modmailForumChannel) {
      throw new Error(
        `Modmail forum channel not found: ${process.env.MODMAIL_FORUM_ID}`
      );
    }

    if (modmailForumChannel.type !== ChannelType.GuildForum) {
      throw new Error(
        `Invalid modmail forum channel: ${process.env.MODMAIL_FORUM_ID}`
      );
    }

    const threadMetadata = StaffThreadView.newThreadMetadata(userId, username);
    const newThread = await modmailForumChannel.threads.create({
      name: threadMetadata.name,
      reason: threadMetadata.reason,
      message: StaffThreadView.initialThreadMessage(userId),
    });

    return this.threadRepository.createThread(
      newThread.guildId,
      userId,
      newThread.id
    );
  }

  async closeThread(
    client: Client,
    thread: Thread,
    userId: string
  ): Promise<void> {
    const threadChannel = await client.channels.fetch(thread.channelId);
    if (!threadChannel) {
      throw new Error(`Thread channel not found: ${thread.channelId}`);
    }

    if (!threadChannel.isThread()) {
      throw new Error(`Not thread: ${thread.channelId}`);
    }

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
