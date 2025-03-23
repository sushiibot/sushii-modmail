import { Client, Collection, type Snowflake } from "discord.js";
import { getLogger } from "utils/logger";
import {
  UserThreadView,
  type UserThreadViewGuild,
  type UserThreadViewUser,
} from "views/UserThreadView";

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
  private client: Client;
  private logger = getLogger("MessageRelayService");

  constructor(client: Client) {
    this.client = client;
  }

  async relayUserMessageToStaff(
    channelId: string,
    message: MessageRelayServiceMessage
  ): Promise<boolean> {
    const threadChannel = await this.client.channels.fetch(channelId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${channelId}`);
    }

    this.logger.debug(message, "Relaying user message to staff");

    let content = `**${message.author.tag}:** ${message.content}`;

    // TODO: Should be download / re-uploaded to the staff thread
    // NOT just links
    const attachments = [...message.attachments.values()];

    await threadChannel.send({
      content: content,
      files: attachments.map((a) => a.url),
    });

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
}
