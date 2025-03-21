import { ChannelType, Client } from "discord.js";
import { ThreadRepository } from "../models/thread.model";
import { Thread } from "../models/thread.model";

export class ThreadService {
  private threadRepository: ThreadRepository;

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

    const created = await modmailForumChannel.threads.create({
      name: `${username}`,
      reason: `New ModMail from ${userId}`,
      message: {
        content: `New ModMail from <@${userId}>`,
      },
    });

    return this.threadRepository.createThread(
      created.guildId,
      userId,
      created.id
    );
  }
}
