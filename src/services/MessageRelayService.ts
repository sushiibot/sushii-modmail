import { Client, Guild, Message, User } from "discord.js";
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

export class MessageRelayService {
  private logger = getLogger("MessageRelayService");

  async relayUserMessageToStaff(
    client: Client,
    channelId: string,
    message: Message
  ): Promise<boolean> {
    const threadChannel = await client.channels.fetch(channelId);
    if (!threadChannel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!threadChannel.isSendable()) {
      throw new Error(`Cannot send to channel: ${channelId}`);
    }

    let content = `**${message.author.tag}:** ${message.content}`;
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
    client: Client,
    userId: string,
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options: StaffMessageOptions = {}
  ): Promise<void> {
    // Fetch the user to DM
    const user = await client.users.fetch(userId);

    // Format the message to include staff member information
    const formattedMessage = UserThreadView.staffMessage(
      guild,
      staffUser,
      content,
      options
    );

    // Send the DM
    await user.send(formattedMessage);
  }

  // Other message service methods would go here
}
