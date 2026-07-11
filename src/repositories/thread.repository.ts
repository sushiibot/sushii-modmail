import { type DB } from "../database/db";
import { threads } from "../database/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Thread } from "../models/thread.model";

// ThreadRepository (data access)
export class ThreadRepository {
  private db: DB;
  private guildId: string;

  constructor(db: DB, guildId: string) {
    this.db = db;
    this.guildId = guildId;
  }

  async createThread(
    guildId: string,
    userId: string,
    channelId: string
  ): Promise<Thread> {
    const createdAt = new Date();
    const inserted = await this.db
      .insert(threads)
      .values({
        guildId,
        threadId: channelId,
        recipientId: userId,
        createdAt,
        closedAt: null,
        title: null,
      })
      .returning();

    return Thread.fromDatabaseRow(inserted[0]);
  }

  async getOpenThreadByUserID(userId: string): Promise<Thread | null> {
    const result = await this.db
      .select()
      .from(threads)
      // User match and thread is open
      // Thread open is just a check for closedAt being null
      .where(
        and(
          eq(threads.recipientId, userId),
          eq(threads.guildId, this.guildId),
          isNull(threads.closedAt)
        )
      )
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    const thread = result[0];

    return Thread.fromDatabaseRow(thread);
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

    return Thread.fromDatabaseRow(thread);
  }

  async closeThread(channelId: string, userId: string): Promise<void> {
    await this.db
      .update(threads)
      .set({ closedAt: new Date(), closedBy: userId })
      .where(eq(threads.threadId, channelId));
  }

  /**
   * Get latest threads created by a specific user
   * @param userId The Discord user ID
   * @param count Number of threads to retrieve
   * @returns Array of threads created by the user
   */
  async getLatestThreadsByUserId(userId: string, count: number): Promise<Thread[]> {
    // Assuming there's a database connection and threads table
    // This query should get all threads for the specified user, ordered by creation date
    const result = await this.db
      .select()
      .from(threads)
      .where(
        and(eq(threads.recipientId, userId), eq(threads.guildId, this.guildId))
      )
      .orderBy(desc(threads.createdAt))
      .limit(count)
      .execute();

    return result.map(Thread.fromDatabaseRow);
  }
}
