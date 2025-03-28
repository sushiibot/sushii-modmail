import type { messages } from "../database/schema";

// Remove MessageSource type as it's not used in the schema
// Instead, the schema uses isStaff boolean

export class Message {
  public readonly threadId: string;
  public readonly messageId: string;
  public readonly authorId: string;
  public readonly isStaff: boolean;
  private readonly _staffRelayedMessageId: string | null;
  public readonly userDmMessageId: string | null;
  public readonly content: string | null;
  public readonly isAnonymous: boolean | null;
  public readonly isPlainText: boolean | null;
  public readonly isSnippet: boolean | null;

  constructor(
    threadId: string,
    messageId: string,
    authorId: string,
    isStaff: boolean,
    staffRelayedMessageId: string | null = null,
    userDmMessageId: string | null = null,
    content: string | null = null,
    isAnonymous: boolean | null = null,
    isPlainText: boolean | null = null,
    isSnippet: boolean | null = null
  ) {
    this.threadId = threadId;
    this.messageId = messageId;
    this.authorId = authorId;
    this.isStaff = isStaff;
    this._staffRelayedMessageId = staffRelayedMessageId;
    this.userDmMessageId = userDmMessageId;
    this.content = content;
    this.isAnonymous = isAnonymous;
    this.isPlainText = isPlainText;
    this.isSnippet = isSnippet;
  }

  static fromDatabaseRow(row: typeof messages.$inferSelect): Message {
    return new Message(
      row.threadId,
      row.messageId,
      row.authorId,
      row.isStaff,
      row.staffRelayedMessageId || null,
      row.userDmMessageId || null,
      row.content || null,
      row.isAnonymous !== undefined ? row.isAnonymous : null,
      row.isPlainText !== undefined ? row.isPlainText : null,
      row.isSnippet !== undefined ? row.isSnippet : null
    );
  }

  get isUser(): boolean {
    return !this.isStaff;
  }

  get userMessageId(): string | never {
    if (this.isUser && this.userDmMessageId) {
      return this.userDmMessageId;
    }

    throw new Error("userMessageId is only available for user messages");
  }

  get staffRelayedMessageId(): string | never {
    if (!this.isUser && this.staffRelayedMessageId) {
      return this.staffRelayedMessageId;
    }

    throw new Error(
      "staffRelayedMessageId is only available for staff messages"
    );
  }
}
