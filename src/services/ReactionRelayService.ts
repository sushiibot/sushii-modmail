import { Client, type Snowflake } from "discord.js";
import type { Message } from "models/message.model";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";
import { UserThreadView } from "views/UserThreadView";

interface Config {
  guildId: string;
}

interface MessageRepository {
  getByThreadMessageId(messageId: string): Promise<Message | null>;
  getByUserDMMessageId(dmMessageId: string): Promise<Message | null>;
  getByStaffDMMessageId(dmMessageId: string): Promise<Message | null>;
}

export class ReactionRelayService {
  private config: Config;
  private client: Client;
  private messageRepository: MessageRepository;
  private logger = getLogger("ReactionRelayService");

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

  /**
   * Relay a reaction from user to staff thread
   * @param userDmMessageId The user's DM message ID that was reacted to
   * @param emoji The emoji that was added
   * @param userId The ID of the user who added the reaction
   */
  async relayUserReactionToStaff(
    userDmMessageId: string,
    emoji: string,
    userId: string
  ): Promise<void> {
    // Get the corresponding thread message

    // User reaction is always on a staff message, so we need to search
    // relayed message ID
    const message = await this.messageRepository.getByStaffDMMessageId(
      userDmMessageId
    );
    if (!message) {
      this.logger.debug(
        { userDmMessageId },
        "No corresponding thread message found for user reaction"
      );
      return;
    }

    // Get the channel and message to add reaction to
    const threadChannel = await this.client.channels.fetch(message.threadId);
    if (!threadChannel?.isThread()) {
      throw new Error(
        `Thread channel not found or not text-based: ${message.threadId}`
      );
    }

    try {
      const threadMessage = await threadChannel.messages.fetch(
        message.messageId
      );

      // Add the reaction to the thread message
      await threadMessage.react(emoji);

      // Send a system message indicating a reaction was added
      const user = await this.client.users.fetch(userId);
      const systemMessage = StaffThreadView.systemMessage(
        `${user.tag} reacted with ${emoji} to a message`
      );

      await threadChannel.send(systemMessage);

      this.logger.debug(
        { userDmMessageId, emoji, threadMessageId: message.messageId },
        "Relayed user reaction to staff thread"
      );
    } catch (error) {
      this.logger.error(
        { error, userDmMessageId, emoji },
        "Failed to relay user reaction to staff"
      );
    }
  }

  /**
   * Relay a removed reaction from user to staff thread
   * @param userDmMessageId The user's DM message ID that the reaction was removed from
   * @param emoji The emoji that was removed
   * @param userId The ID of the user who removed the reaction
   */
  async relayUserReactionRemovalToStaff(
    userDmMessageId: string,
    emoji: string,
    userId: string
  ): Promise<void> {
    // Get the corresponding thread message
    const message = await this.messageRepository.getByStaffDMMessageId(
      userDmMessageId
    );
    if (!message) {
      this.logger.debug(
        { userDmMessageId },
        "No corresponding thread message found for user reaction removal"
      );
      return;
    }

    // Get the channel and message to remove reaction from
    const threadChannel = await this.client.channels.fetch(message.threadId);
    if (!threadChannel?.isThread()) {
      throw new Error(
        `Thread channel not found or not text-based: ${message.threadId}`
      );
    }

    try {
      const threadMessage = await threadChannel.messages.fetch(
        message.messageId
      );

      // Get users who reacted with this emoji
      const reactions = threadMessage.reactions.cache.get(emoji);
      if (reactions) {
        // Remove bot's reaction to reflect user's removal
        await reactions.remove();
      }

      // Send a system message indicating a reaction was removed
      const user = await this.client.users.fetch(userId);
      const systemMessage = StaffThreadView.systemMessage(
        `${user.tag} removed their ${emoji} reaction from a message`
      );

      await threadChannel.send(systemMessage);

      this.logger.debug(
        { userDmMessageId, emoji, threadMessageId: message.messageId },
        "Relayed user reaction removal to staff thread"
      );
    } catch (error) {
      this.logger.error(
        { error, userDmMessageId, emoji },
        "Failed to relay user reaction removal to staff"
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Staff -> User

  /**
   * Relay a reaction from staff to user DM
   * @param threadMessageId The thread message ID that was reacted to
   * @param emoji The emoji that was added
   * @param staffUserId The ID of the staff member who added the reaction
   */
  async relayStaffReactionToUser(
    threadMessageId: string,
    emoji: string
  ): Promise<void> {
    // Get the corresponding DM message
    const message = await this.messageRepository.getByThreadMessageId(
      threadMessageId
    );

    if (!message) {
      this.logger.warn(
        { threadMessageId },
        "No corresponding DM message found for staff reaction"
      );

      return;
    }

    // Only relay staff reactions on user messages
    if (message.isStaff) {
      this.logger.warn(
        { threadMessageId },
        "Message is on a staff message, ignoring staff reaction"
      );

      return;
    }

    try {
      // Get user to DM
      const user = await this.client.users.fetch(message.authorId);
      const dmChannel = await user.createDM();

      // React to the user's message
      await dmChannel.messages.react(message.staffRelayedMessageId, emoji);

      this.logger.debug(
        {
          threadMessageId,
          emoji,
          dmMessageId: message.staffRelayedMessageId,
        },
        "Relayed staff reaction to user DM"
      );
    } catch (error) {
      this.logger.error(
        { error, threadMessageId, emoji },
        "Failed to relay staff reaction to user"
      );
    }
  }

  /**
   * Relay a removed reaction from staff to user DM
   * @param threadMessageId The thread message ID that the reaction was removed from
   * @param emoji The emoji that was removed
   * @param staffUserId The ID of the staff member who removed the reaction
   */
  async relayStaffReactionRemovalToUser(
    threadMessageId: string,
    emoji: string
  ): Promise<void> {
    // Get the corresponding DM message
    const message = await this.messageRepository.getByThreadMessageId(
      threadMessageId
    );
    if (!message) {
      this.logger.debug(
        { threadMessageId },
        "No corresponding DM message found for staff reaction removal"
      );
      return;
    }

    if (!message.isStaff) {
      this.logger.debug(
        { threadMessageId },
        "No relayed message ID found for staff reaction removal"
      );

      return;
    }

    try {
      // Get user to DM
      const user = await this.client.users.fetch(message.authorId);
      const dmChannel = await user.createDM();

      // Fetch the message to remove reaction from
      const dmMessage = await dmChannel.messages.fetch(
        message.staffRelayedMessageId
      );

      // Get the reaction to remove (bot's reaction)
      const reaction = dmMessage.reactions.cache.get(emoji);
      if (reaction) {
        await reaction.remove();
      }

      this.logger.debug(
        {
          threadMessageId,
          emoji,
          dmMessageId: message.staffRelayedMessageId,
        },
        "Relayed staff reaction removal to user DM"
      );
    } catch (error) {
      this.logger.error(
        { error, threadMessageId, emoji },
        "Failed to relay staff reaction removal to user"
      );
    }
  }
}
