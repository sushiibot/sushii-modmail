import {
  Client,
  DiscordAPIError,
  DiscordjsErrorCodes,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Message } from "models/message.model";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

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
   * @param userId The ID of the user who added the reaction
   * @param emojiIdentifier The emoji that was added
   * @param emojiString The string representation of the emoji (optional)
   */
  async relayUserReactionToStaff(
    userDmMessageId: string,
    userId: string,
    emojiIdentifier: string,
    emojiString: string
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

      // Send a system message indicating a reaction was added
      const user = await this.client.users.fetch(userId);

      const emojiID = this.client.emojis.resolveId(emojiIdentifier);
      const emojiURL = this.client.rest.cdn.emoji(emojiID);

      const systemMessage = StaffThreadView.systemMessage(
        `${user.tag} reacted with ${emojiString} ([\`${emojiIdentifier}\`](<${emojiURL}>))`,
        {
          automated: false,
        }
      );

      // Add reply to the reacted message
      systemMessage.reply = {
        messageReference: message.messageId,
      };

      await threadChannel.send(systemMessage);

      try {
        // Add the reaction to the thread message
        await threadMessage.react(emojiIdentifier);
      } catch (err) {
        if (!(err instanceof DiscordAPIError)) {
          // Unrelated error, throw
          throw err;
        }

        // Custom emoji, bot doesn't have access to it, fine
        if (err.code === RESTJSONErrorCodes.UnknownEmoji) {
          this.logger.debug(
            { error: err, emojiIdentifier },
            "Failed to add reaction to thread message, bot doesn't have access to the emoji"
          );
        }
      }

      this.logger.debug(
        {
          threadMessageId: message.messageId,
          userDmMessageId,
          emojiIdentifier,
          emojiString,
        },
        "Relayed user reaction to staff thread"
      );
    } catch (error) {
      this.logger.error(
        { error, userDmMessageId, emojiIdentifier },
        "Failed to relay user reaction to staff"
      );
    }
  }

  /**
   * Relay a removed reaction from user to staff thread
   * @param userDmMessageId The user's DM message ID that the reaction was removed from
   * @param emoji The emoji that was removed
   * @param emojiIdentifier The ID of the user who removed the reaction
   */
  async relayUserReactionRemovalToStaff(
    userDmMessageId: string,
    userId: string,
    emojiIdentifier: string,
    emojiString: string
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
      const reactions = threadMessage.reactions.cache.get(emojiIdentifier);
      if (reactions) {
        // Remove bot's reaction to reflect user's removal
        await reactions.remove();
      }

      const emojiID = this.client.emojis.resolveId(emojiIdentifier);
      const emojiURL = this.client.rest.cdn.emoji(emojiID);

      // Send a system message indicating a reaction was removed
      const user = await this.client.users.fetch(userId);
      const systemMessage = StaffThreadView.systemMessage(
        `${user.tag} removed reaction ${emojiString} ([\`${emojiIdentifier}\`](<${emojiURL}>))`,
        {
          automated: false,
        }
      );

      // Add reply to the reacted message
      systemMessage.reply = {
        messageReference: message.messageId,
      };

      await threadChannel.send(systemMessage);

      this.logger.debug(
        {
          threadMessageId: message.messageId,
          userDmMessageId,
          emojiIdentifier,
          emojiString,
        },
        "Relayed user reaction removal to staff thread"
      );
    } catch (error) {
      this.logger.error(
        { error, userDmMessageId, emojiIdentifier },
        "Failed to relay user reaction removal to staff"
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Staff -> User

  /**
   * Relay a reaction from staff to user DM
   * @param threadMessageId The thread message ID that was reacted to
   * @param emojiIdentifier The emoji that was added
   * @param staffUserId The ID of the staff member who added the reaction
   */
  async relayStaffReactionToUser(
    threadMessageId: string,
    emojiIdentifier: string
  ): Promise<void> {
    this.logger.debug(
      { threadMessageId, emoji: emojiIdentifier },
      "Relaying staff reaction to user DM"
    );

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
    if (message.isStaff()) {
      this.logger.debug(
        { threadMessageId },
        "Message is on a staff message, ignoring staff reaction"
      );

      return;
    }

    try {
      this.logger.debug(
        {
          message,
          emoji: emojiIdentifier,
        },
        "Relaying staff reaction to user DM"
      );

      // Get user's DM channel
      const user = await this.client.users.fetch(message.authorId);
      const dmChannel = await user.createDM();

      // React to the user's message
      try {
        await dmChannel.messages.react(
          message.userDmMessageId,
          emojiIdentifier
        );
      } catch (err) {
        if (!(err instanceof DiscordAPIError)) {
          throw err;
        }

        // Custom emoji, bot doesn't have access to it, respond with a warning
        if (err.code === RESTJSONErrorCodes.UnknownEmoji) {
          this.logger.debug(
            { error: err, emojiIdentifier },
            "Failed to add reaction to user DM message, bot doesn't have access to the emoji"
          );

          // Send a warning message to staff thread
          const warningMessage = StaffThreadView.systemMessage(
            `I couldn't add the reaction ${emojiIdentifier} to the user's message. I can only add reactions for emojis from servers I'm in.`,
            {
              automated: false,
            }
          );

          const threadChannel = await this.client.channels.fetch(
            message.threadId
          );

          if (threadChannel?.isThread()) {
            await threadChannel.send(warningMessage);
          }
        }
      }

      this.logger.debug(
        {
          threadMessageId,
          emoji: emojiIdentifier,
          dmMessageId: message.userDmMessageId,
        },
        "Relayed staff reaction to user DM"
      );
    } catch (error) {
      this.logger.error(
        { error, threadMessageId, emoji: emojiIdentifier },
        "Failed to relay staff reaction to user"
      );
    }
  }

  /**
   * Relay a removed reaction from staff to user DM
   * @param threadMessageId The thread message ID that the reaction was removed from
   * @param emojiIdentifier The emoji that was removed
   * @param staffUserId The ID of the staff member who removed the reaction
   */
  async relayStaffReactionRemovalToUser(
    threadMessageId: string,
    emojiIdentifier: string
  ): Promise<void> {
    this.logger.debug(
      { threadMessageId, emoji: emojiIdentifier },
      "Deleting staff reaction from user DM"
    );

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

    if (message.isStaff()) {
      this.logger.debug(
        { threadMessageId },
        "Staff react on staff message, ignoring staff reaction removal"
      );

      return;
    }

    try {
      // Get user to DM
      const user = await this.client.users.fetch(message.authorId);
      const dmChannel = await user.createDM();

      // Fetch the message to remove reaction from
      const dmMessage = await dmChannel.messages.fetch(message.userDmMessageId);

      // Get the reaction to remove (bot's reaction)
      const reaction = dmMessage.reactions.cache.get(emojiIdentifier);
      if (reaction) {
        // Delete only own reaction to use /@me route in DMs
        await reaction.users.remove(this.client.user!);
      }

      this.logger.debug(
        {
          threadMessageId,
          emoji: emojiIdentifier,
          dmMessageId: message.userDmMessageId,
        },
        "Relayed staff reaction removal to user DM"
      );
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : String(error),
          threadMessageId,
          emoji: emojiIdentifier,
        },
        "Failed to relay staff reaction removal to user"
      );
    }
  }
}
