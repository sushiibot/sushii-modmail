import { type DB } from "../database/db";
import { messages } from "../database/schema";
import { eq } from "drizzle-orm";
import { Message } from "../models/message.model";
import { getLogger } from "utils/logger";

export type NewMessage = {
  messageId: string;
  threadId: string;
  authorId: string;
  isStaff: boolean;
  staffRelayedMessageId?: string | null;
  userDmMessageId?: string | null;
  content?: string | null;
  isAnonymous?: boolean | null;
  isPlainText?: boolean | null;
  isSnippet?: boolean | null;
};

export class MessageRepository {
  private db: DB;

  private logger = getLogger(this.constructor.name);

  constructor(db: DB) {
    this.db = db;
  }

  async saveMessage(msg: NewMessage): Promise<Message> {
    this.logger.debug({ msg }, "Creating message");

    const inserted = await this.db
      .insert(messages)
      .values({
        messageId: msg.messageId,
        threadId: msg.threadId,
        authorId: msg.authorId,
        isStaff: msg.isStaff,
        staffRelayedMessageId: msg.staffRelayedMessageId || null,
        userDmMessageId: msg.userDmMessageId || null,
        // Do not use || null or it'll make falsey values null
        content: msg.content,
        isAnonymous: msg.isAnonymous,
        isPlainText: msg.isPlainText,
        isSnippet: msg.isSnippet,
      })
      .returning();

    return Message.fromDatabaseRow(inserted[0]);
  }

  /**
   * Get a message by the message ID of a bot message in a staff thread.
   * E.g. From the bot's message in a modmail thread:
   * If it's a staff message -> Get the forwarded message ID
   * If it's a user's message -> Get the original user's DM message ID
   *
   * @param messageId
   * @returns
   */
  async getByThreadMessageId(messageId: string): Promise<Message | null> {
    const result = await this.db
      .select()
      .from(messages)
      .where(eq(messages.messageId, messageId))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return Message.fromDatabaseRow(result[0]);
  }

  /**
   * Get a message by the message ID of the staff relayed message.
   * Staff's message sent to DMs -> Get the message in the staff thread
   *
   * @param dmMessageId
   * @returns
   */
  async getByStaffDMMessageId(dmMessageId: string): Promise<Message | null> {
    const result = await this.db
      .select()
      .from(messages)
      .where(eq(messages.staffRelayedMessageId, dmMessageId))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return Message.fromDatabaseRow(result[0]);
  }

  /**
   *  Get a message by the message ID of the original user's DM message.
   * E.g. From user original DM -> Get relayed message in staff thread
   *
   * @param dmMessageId
   * @returns
   */
  async getByUserDMMessageId(dmMessageId: string): Promise<Message | null> {
    const result = await this.db
      .select()
      .from(messages)
      .where(eq(messages.userDmMessageId, dmMessageId))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return Message.fromDatabaseRow(result[0]);
  }
}
