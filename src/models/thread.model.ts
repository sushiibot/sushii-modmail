import { type DB } from "../database/db";
import { threads } from "../database/schema";
import { and, eq, isNull } from "drizzle-orm";

// Thread model (data structure)
export class Thread {
  constructor(
    public guildId: string,
    public channelId: string,
    public userId: string,
    public createdAt: Date,
    public closedAt: Date | null = null,
    public title: string | null = null
  ) {}

  isOpen(): boolean {
    return this.closedAt === null;
  }
}

// ThreadRepository (data access)
export class ThreadRepository {
  constructor(private db: DB) {}

  async createThread(
    guildId: string,
    userId: string,
    channelId: string
  ): Promise<Thread> {
    const createdAt = new Date();
    await this.db.insert(threads).values({
      guildId,
      threadId: channelId,
      recipientId: userId,
      createdAt,
      closedAt: null,
      title: null,
    });

    return new Thread(guildId, channelId, userId, createdAt);
  }

  async getOpenThreadByUserID(userId: string): Promise<Thread | null> {
    const result = await this.db
      .select()
      .from(threads)
      // User match and thread is open
      // Thread open is just a check for closedAt being null
      .where(and(eq(threads.recipientId, userId), isNull(threads.closedAt)))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    const thread = result[0];

    return new Thread(
      thread.guildId,
      thread.threadId,
      thread.recipientId,
      thread.createdAt,
      thread.closedAt,
      thread.title
    );
  }

  async getThreadByChannelId(channelId: string): Promise<Thread | null> {
    const result = await this.db
      .select()
      .from(threads)
      .where(eq(threads.threadId, channelId))
      .execute();

    if (result.length === 0) {
      return null;
    }

    const thread = result[0];

    return new Thread(
      thread.guildId,
      thread.threadId,
      thread.recipientId,
      thread.createdAt,
      thread.closedAt,
      thread.title
    );
  }

  async closeThread(channelId: string): Promise<void> {
    await this.db
      .update(threads)
      .set({ closedAt: new Date() })
      .where(eq(threads.threadId, channelId));
  }
}
