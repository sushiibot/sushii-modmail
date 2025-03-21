import type { threads } from "database/schema";

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

  static fromDatabaseRow(row: typeof threads.$inferSelect): Thread {
    return new Thread(
      row.guildId,
      row.threadId,
      row.recipientId,
      row.createdAt,
      row.closedAt,
      row.title
    );
  }

  isOpen(): boolean {
    return this.closedAt === null;
  }
}
