import type { messages } from "../database/schema";

export class BaseMessage {
  public readonly threadId: string;
  public readonly messageId: string;
  public readonly authorId: string;
  private readonly _isStaff: boolean;
  protected readonly _staffRelayedMessageId: string | null;
  protected readonly _userDmMessageId: string | null;
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
    this._isStaff = isStaff;
    this._staffRelayedMessageId = staffRelayedMessageId;
    this._userDmMessageId = userDmMessageId;
    this.content = content;
    this.isAnonymous = isAnonymous;
    this.isPlainText = isPlainText;
    this.isSnippet = isSnippet;
  }

  isUser(): this is UserMessage {
    return !this._isStaff;
  }

  isStaff(): this is StaffMessage {
    return this._isStaff;
  }
}

export class StaffMessage extends BaseMessage {
  constructor(
    threadId: string,
    messageId: string,
    authorId: string,
    staffRelayedMessageId: string,
    userDmMessageId: string | null = null,
    content: string | null = null,
    isAnonymous: boolean | null = null,
    isPlainText: boolean | null = null,
    isSnippet: boolean | null = null
  ) {
    super(
      threadId,
      messageId,
      authorId,
      true,
      staffRelayedMessageId,
      userDmMessageId,
      content,
      isAnonymous,
      isPlainText,
      isSnippet
    );
  }

  get staffRelayedMessageId(): string {
    if (!this.isUser() && this._staffRelayedMessageId) {
      return this._staffRelayedMessageId;
    }

    throw new Error(
      "staffRelayedMessageId is only available for staff messages"
    );
  }
}

export class UserMessage extends BaseMessage {
  constructor(
    threadId: string,
    messageId: string,
    authorId: string,
    userDmMessageId: string,
    content: string | null = null,
    isAnonymous: boolean | null = null,
    isPlainText: boolean | null = null,
    isSnippet: boolean | null = null
  ) {
    super(
      threadId,
      messageId,
      authorId,
      false,
      null,
      userDmMessageId,
      content,
      isAnonymous,
      isPlainText,
      isSnippet
    );
  }

  get userDmMessageId(): string {
    if (this.isUser() && this._userDmMessageId) {
      return this._userDmMessageId;
    }

    throw new Error("userDmMessageId is only available for user messages");
  }
}

export type Message = StaffMessage | UserMessage;

export const Message = {
  fromDatabaseRow(row: typeof messages.$inferSelect): Message {
    if (row.isStaff) {
      return new StaffMessage(
        row.threadId,
        row.messageId,
        row.authorId,
        row.staffRelayedMessageId || "",
        row.userDmMessageId || null,
        row.content || null,
        row.isAnonymous !== undefined ? row.isAnonymous : null,
        row.isPlainText !== undefined ? row.isPlainText : null,
        row.isSnippet !== undefined ? row.isSnippet : null
      );
    } else {
      return new UserMessage(
        row.threadId,
        row.messageId,
        row.authorId,
        row.userDmMessageId || "",
        row.content || null,
        row.isAnonymous !== undefined ? row.isAnonymous : null,
        row.isPlainText !== undefined ? row.isPlainText : null,
        row.isSnippet !== undefined ? row.isSnippet : null
      );
    }
  },
};
