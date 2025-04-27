import type { messages } from "../database/schema";

interface StaffMessageOptions {
  isAnonymous: boolean;
  isPlainText: boolean;
  isSnippet: boolean;
}

export class BaseMessage {
  public readonly threadId: string;
  public readonly messageId: string;
  public readonly authorId: string;
  private readonly _isStaff: boolean;
  protected readonly _staffRelayedMessageId: string | null;
  protected readonly _userDmMessageId: string | null;
  public readonly content: string | null;
  public readonly forwarded: boolean;

  constructor(
    threadId: string,
    messageId: string,
    authorId: string,
    isStaff: boolean,
    staffRelayedMessageId: string | null = null,
    userDmMessageId: string | null = null,
    content: string | null = null,
    forwarded: boolean = false
  ) {
    this.threadId = threadId;
    this.messageId = messageId;
    this.authorId = authorId;
    this._isStaff = isStaff;
    this._staffRelayedMessageId = staffRelayedMessageId;
    this._userDmMessageId = userDmMessageId;
    this.content = content;
    this.forwarded = forwarded;
  }

  isUser(): this is UserMessage {
    return !this._isStaff;
  }

  isStaff(): this is StaffMessage {
    return this._isStaff;
  }
}

export class StaffMessage extends BaseMessage {
  public readonly isAnonymous: boolean;
  public readonly isPlainText: boolean;
  public readonly isSnippet: boolean;
  // Override the content type to be non-null
  public readonly content: string;

  constructor(
    threadId: string,
    messageId: string,
    authorId: string,
    staffRelayedMessageId: string,
    content: string,
    forwarded: boolean = false,
    options: StaffMessageOptions
  ) {
    super(
      threadId,
      messageId,
      authorId,
      true,
      staffRelayedMessageId,
      null,
      content,
      forwarded
    );

    this.content = content;

    this.isAnonymous = options.isAnonymous;
    this.isPlainText = options.isPlainText;
    this.isSnippet = options.isSnippet;
  }

  get staffRelayedMessageId(): string {
    if (this._staffRelayedMessageId) {
      return this._staffRelayedMessageId;
    }

    throw new Error(
      `Staff message ${this.messageId} does not have a relayed message ID`
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
    forwarded: boolean = false
  ) {
    super(
      threadId,
      messageId,
      authorId,
      false,
      null,
      userDmMessageId,
      content,
      forwarded
    );
  }

  get userDmMessageId(): string {
    if (this._userDmMessageId) {
      return this._userDmMessageId;
    }

    throw new Error(
      `User message ${this.messageId} does not have a user DM message ID`
    );
  }
}

export type Message = StaffMessage | UserMessage;

export const Message = {
  fromDatabaseRow(row: typeof messages.$inferSelect): Message {
    if (row.isStaff) {
      if (row.staffRelayedMessageId === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing staffRelayedMessageId`
        );
      }
      if (row.content === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing content`
        );
      }
      if (row.isAnonymous === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing isAnonymous flag`
        );
      }
      if (row.isPlainText === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing isPlainText flag`
        );
      }
      if (row.isSnippet === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing isSnippet flag`
        );
      }
      if (row.forwarded === null) {
        throw new Error(
          `Invalid staff message ${row.messageId}: missing forwarded flag`
        );
      }

      return new StaffMessage(
        row.threadId,
        row.messageId,
        row.authorId,
        row.staffRelayedMessageId,
        row.content,
        row.forwarded,
        {
          isAnonymous: row.isAnonymous,
          isPlainText: row.isPlainText,
          isSnippet: row.isSnippet,
        }
      );
    } else {
      if (row.userDmMessageId === null) {
        throw new Error(
          `Invalid user message ${row.messageId}: missing userDmMessageId`
        );
      }
      if (row.forwarded === null) {
        throw new Error(
          `Invalid user message ${row.messageId}: missing forwarded flag`
        );
      }

      return new UserMessage(
        row.threadId,
        row.messageId,
        row.authorId,
        row.userDmMessageId,
        row.content || null,
        row.forwarded
      );
    }
  },
};
