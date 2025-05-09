import type { botEmojis } from "database/schema";
import { z } from "zod";

export const BotEmojiNameSchema = z.enum([
  "delete",
  "edit",
  "logs",
  "message_id",
  "message_reply",
  "message",
  "plain_text",
  "settings",
  "snippet",
  "staff_user",
  "tag",
  "prefix",
  "channel",
  "arrow_down_right",
]);

export type BotEmojiName = z.infer<typeof BotEmojiNameSchema>;

export class BotEmoji {
  public readonly name: BotEmojiName;
  public readonly id: string;
  public readonly sha256: string;

  constructor(name: BotEmojiName, id: string, sha256: string) {
    this.name = name;
    this.id = id;
    this.sha256 = sha256;
  }

  static fromDatabaseRow(row: typeof botEmojis.$inferSelect): BotEmoji {
    const name = BotEmojiNameSchema.safeParse(row.name);

    if (!name.success) {
      throw new Error(
        `Invalid emoji name ${row.name} for emoji ${row.id}, does not match enum`
      );
    }

    return new BotEmoji(name.data, row.id, row.sha256);
  }

  toEmojiString(): string {
    return `<:${this.name}:${this.id}>`;
  }
}
