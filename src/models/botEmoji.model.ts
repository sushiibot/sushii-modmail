import type { botEmojis } from "database/schema";

// Just to match queries, not actually validated
export type BotEmojiName =
  | "delete"
  | "edit"
  | "logs"
  | "message_id"
  | "message_reply"
  | "message"
  | "plain_text"
  | "settings"
  | "snippet"
  | "staff_user"
  | "tag";

export class BotEmoji {
  public readonly name: string;
  public readonly id: string;
  public readonly sha256: string;

  constructor(name: string, id: string, sha256: string) {
    this.name = name;
    this.id = id;
    this.sha256 = sha256;
  }

  static fromDatabaseRow(row: typeof botEmojis.$inferSelect): BotEmoji {
    return new BotEmoji(row.name, row.id, row.sha256);
  }

  toEmojiString(): string {
    return `<:${this.name}:${this.id}>`;
  }
}
