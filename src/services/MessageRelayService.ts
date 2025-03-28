import { Client, Collection, type Snowflake } from "discord.js";
import type { Message } from "models/message.model";
import type { NewMessage } from "repositories/message.repository";
import { getLogger } from "utils/logger";
import {
  StaffThreadView,
  type StaffViewUserMessage,
} from "views/StaffThreadView";
import {
  UserThreadView,
  type UserThreadViewGuild,
  type UserThreadViewUser,
} from "views/UserThreadView";

interface Config {
  initialMessage: string;
  guildId: string;
}

export interface StaffMessageOptions {
  anonymous: boolean;
  plainText: boolean;
  snippet: boolean;
}

export const defaultStaffMessageOptions: StaffMessageOptions = {
  anonymous: false,
  plainText: false,
  snippet: false,
};

export interface Attachment {
  id: Snowflake;
  name: string;
  size: number;
  url: string;
}

export interface MessageRelayServiceMessage {
  author: {
    tag: string;
  };
  content: string;
  attachments: Collection<Snowflake, Attachment>;
}

interface MessageRepository {
  saveMessage(msg: NewMessage): Promise<Message>;
  getByThreadMessageId(messageId: string): Promise<Message | null>;
  getByUserDMMessageId(dmMessageId: string): Promise<Message | null>;
}

export class MessageRelayService {
  private config: Config;
  private client: Client;

  private messageRepository: MessageRepository;

  private logger = getLogger("MessageRelayService");

  constructor(
    config: Config,
    client: Client,
    messageRepository: MessageRepository
  ) {
    this.config = config;
    this.client = client;
    this.messageRepository = messageRepository;
  }

  // ---------------------------------------------------------------------------
  // User -> Staff

  async relayUserMessageToStaff(
    threadId: string,
    message: StaffViewUserMessage
  ): Promise<boolean> {
    const threadChannel = await this.client.channels.fetch(threadId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${threadId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${threadId}`);
    }

    this.logger.debug(
      {
        user: message.author.username,
        content: message.content,
      },
      "Relaying user message to staff"
    );

    const msg = await StaffThreadView.userReplyMessage(message);
    const relayedMsg = await threadChannel.send(msg);

    // Save message to database
    await this.messageRepository.saveMessage({
      threadId: threadId,
      // Message in forum thread
      messageId: relayedMsg.id,
      isStaff: false,
      // Original User's DM message
      authorId: message.author.id,
      userDmMessageId: message.id,
      content: message.content,
      // Staff columns
      // Not a staff message, so no relayed message
      staffRelayedMessageId: null,
      isAnonymous: null,
      isPlainText: null,
      isSnippet: null,
    });

    // TODO: Blocked return false OR if more than 2 options, return an emoji
    return true;
  }

  async relayUserEditedMessageToStaff(
    threadId: string,
    message: StaffViewUserMessage
  ): Promise<void> {
    const threadChannel = await this.client.channels.fetch(threadId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${threadId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${threadId}`);
    }

    this.logger.debug(
      {
        user: message.author.username,
        content: message.content,
      },
      "Relaying user edited message to staff"
    );

    // Gets the thread message from user original DM message ID
    const threadMessage = await this.messageRepository.getByUserDMMessageId(
      message.id
    );

    const msg = await StaffThreadView.userReplyEditedMessage(
      message,
      // ThreadMessage ID is always the message in the staff thread
      threadMessage?.messageId
    );

    await threadChannel.send(msg);
  }

  async relayUserDeletedMessageToStaff(
    threadId: string,
    messageId: string
  ): Promise<void> {
    const threadChannel = await this.client.channels.fetch(threadId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${threadId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${threadId}`);
    }

    this.logger.debug(
      {
        messageId,
      },
      "Relaying user deleted message to staff"
    );

    const threadMessage = await this.messageRepository.getByUserDMMessageId(
      messageId
    );

    const msg = StaffThreadView.userReplyDeletedMessage(
      messageId,
      threadMessage?.messageId
    );

    await threadChannel.send(msg);
  }

  // ---------------------------------------------------------------------------
  // Staff -> User

  /**
   * Relay a message from staff to a user via DM
   * @param client The Discord client
   * @param userId The Discord user ID to send the message to
   * @param staffUser The staff member who sent the message
   * @param content The message content
   * @param options Message options
   * @returns The ID of the relayed message
   */
  async relayStaffMessageToUser(
    userId: string,
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options: StaffMessageOptions = defaultStaffMessageOptions
  ): Promise<{ msgId: string; dmChannelId: string }> {
    // Fetch the user to DM
    const user = await this.client.users.fetch(userId);

    // Format the message to include staff member information
    const message = UserThreadView.staffMessage(
      guild,
      staffUser,
      content,
      options
    );

    this.logger.debug(message, "Relaying staff message to user");

    // Send the DM
    const relayedMsg = await user.send(message);

    return {
      msgId: relayedMsg.id,
      dmChannelId: relayedMsg.channel.id,
    };
  }

  async saveStaffMessage(options: {
    threadId: string;
    threadMessageId: string;
    relayedMessageId: string;
    authorId: string;
    content: string;
    isAnonymous: boolean;
    isPlainText: boolean;
    isSnippet: boolean;
  }): Promise<void> {
    await this.messageRepository.saveMessage({
      threadId: options.threadId,
      messageId: options.threadMessageId,
      isStaff: true,
      authorId: options.authorId,
      staffRelayedMessageId: options.relayedMessageId,
      // Not user
      userDmMessageId: null,
      content: options.content,
      isAnonymous: options.isAnonymous,
      isPlainText: options.isPlainText,
      isSnippet: options.isSnippet,
    });
  }

  /**
   * Relay an edited message from staff to a user
   * @param staffViewMessageId The ID of the staff message
   * @param userId The Discord user ID to send the message to
   * @param guild The guild
   * @param staffUser The staff member who edited the message
   * @param content The new message content
   * @param options Message options
   */
  async editStaffMessage(
    staffViewMessageId: string,
    userId: string,
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options: StaffMessageOptions = defaultStaffMessageOptions
  ): Promise<void> {
    // Fetch the user to DM
    const user = await this.client.users.fetch(userId);

    // Fetch the original message from the database
    const messageData = await this.messageRepository.getByThreadMessageId(
      staffViewMessageId
    );
    if (!messageData) {
      throw new Error(`Message not found: ${staffViewMessageId}`);
    }

    this.logger.debug(messageData, "Editing relayed staff message");

    // Re-build staff message with new content
    // Exclude flags since they are incompatible with editing
    const { flags, ...newMessage } = UserThreadView.staffMessage(
      guild,
      staffUser,
      content,
      options
    );

    // Edit the message
    const dmChannel = await user.createDM();
    await dmChannel.messages.edit(
      messageData.staffRelayedMessageId,
      newMessage
    );
  }

  /**
   * Delete a relayed message from staff
   * @param userId The Discord user ID to delete a message from
   * @param messageId The ID of the deleted message
   */
  async deleteStaffMessage(
    userId: string,
    staffViewMessageId: string
  ): Promise<void> {
    // Fetch the user to DM
    const user = await this.client.users.fetch(userId);

    // Fetch the original message from the database
    const messageData = await this.messageRepository.getByThreadMessageId(
      staffViewMessageId
    );
    if (!messageData) {
      throw new Error(`Message not found: ${staffViewMessageId}`);
    }

    this.logger.debug(messageData, "Deleting relayed staff message");

    // Delete the message
    const dmChannel = await user.createDM();
    await dmChannel.messages.delete(messageData.staffRelayedMessageId);
  }

  /**
   * Sends the initial welcome message to a user when they create a new thread
   * @param userId The Discord user ID to send the welcome message to
   * @param channelId The thread channel ID
   * @returns The initial message content
   */
  async sendInitialMessageToUser(userId: string): Promise<string> {
    // Fetch the user
    const user = await this.client.users.fetch(userId);

    // Fetch the modmail guild
    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (!guild) {
      throw new Error(`Guild not found: ${this.config.guildId}`);
    }

    const initialMessageContent = this.config.initialMessage;

    // Generate initial message
    const initialMessage = UserThreadView.initialMessage(
      guild,
      initialMessageContent
    );

    // Send to user
    await user.send(initialMessage);

    return initialMessageContent;
  }

  async sendInitialMessageToStaff(
    channelId: string,
    content: string
  ): Promise<void> {
    const threadChannel = await this.client.channels.fetch(channelId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${channelId}`);
    }

    const msg = StaffThreadView.systemMessage(content);

    await threadChannel.send(msg);
  }
}
