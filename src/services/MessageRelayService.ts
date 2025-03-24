import { Client, Collection, type Snowflake } from "discord.js";
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
  anonymous?: boolean;
  plainText?: boolean;
}

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

export class MessageRelayService {
  private config: Config;
  private client: Client;

  private logger = getLogger("MessageRelayService");

  constructor(config: Config, client: Client) {
    this.config = config;
    this.client = client;
  }

  async relayUserMessageToStaff(
    channelId: string,
    message: StaffViewUserMessage
  ): Promise<boolean> {
    const threadChannel = await this.client.channels.fetch(channelId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${channelId}`);
    }

    this.logger.debug(
      {
        user: message.author.username,
        content: message.content,
      },
      "Relaying user message to staff"
    );

    const msg = await StaffThreadView.userReplyMessage(message);
    await threadChannel.send(msg);

    // TODO: Blocked return false OR if more than 2 options, return an emoji
    return true;
  }

  /**
   * Relay a message from staff to a user via DM
   * @param client The Discord client
   * @param userId The Discord user ID to send the message to
   * @param staffUser The staff member who sent the message
   * @param content The message content
   * @returns True if the message was sent successfully
   */
  async relayStaffMessageToUser(
    userId: string,
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options: StaffMessageOptions = {}
  ): Promise<void> {
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
    await user.send(message);
  }

  /**
   * Sends the initial welcome message to a user when they create a new thread
   * @param userId The Discord user ID to send the welcome message to
   * @param channelId The thread channel ID
   * @returns True if the message was sent successfully
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
