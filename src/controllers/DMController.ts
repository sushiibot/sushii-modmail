import {
  ChannelType,
  Client,
  Message,
  MessageReaction,
  User,
  type OmitPartialGroupDMChannel,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
} from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";
import type { StaffViewUserMessage } from "views/StaffThreadView";
import { MySqlBigInt53 } from "drizzle-orm/mysql-core";

export interface MessageRelayService {
  relayUserMessageToStaff(
    threadId: string,
    message: StaffViewUserMessage
  ): Promise<boolean>;
  relayUserEditedMessageToStaff(
    threadId: string,
    message: StaffViewUserMessage
  ): Promise<void>;
  relayUserDeletedMessageToStaff(
    threadId: string,
    messageId: string
  ): Promise<void>;
  sendInitialMessageToUser(userId: string): Promise<string>;
  sendInitialMessageToStaff(channelId: string, content: string): Promise<void>;
}

export interface ReactionRelayService {
  relayUserReactionToStaff(
    userDmMessageId: string,
    emoji: string,
    userId: string
  ): Promise<void>;
  relayUserReactionRemovalToStaff(
    userDmMessageId: string,
    emoji: string,
    userId: string
  ): Promise<void>;
}

export interface Thread {
  channelId: string;
}

export interface ThreadService {
  getOrCreateThread(
    userId: string,
    username: string
  ): Promise<{ thread: Thread; isNew: boolean }>;
  getThread(userId: string): Promise<Thread | null>;
}

export class DMController {
  private threadService: ThreadService;
  private messageService: MessageRelayService;
  private reactionService: ReactionRelayService;

  private logger = getLogger(this.constructor.name);

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService,
    reactionService: ReactionRelayService
  ) {
    this.threadService = threadService;
    this.messageService = messageService;
    this.reactionService = reactionService;
  }

  async handleUserDM(client: Client, message: Message): Promise<void> {
    try {
      if (message.channel.type !== ChannelType.DM) {
        return;
      }

      this.logger.debug(`Handling DM from ${message.author.tag}`);

      if (message.author.bot) {
        return;
      }

      this.logger.debug(`Handling DM from ${message.author.tag}`);

      const userId = message.author.id;
      let { thread, isNew } = await this.threadService.getOrCreateThread(
        userId,
        message.author.username
      );

      const success = await this.messageService.relayUserMessageToStaff(
        thread.channelId,
        message
      );

      if (success) {
        // React to the user's message to indicate that it was received
        await message.react("✅");

        // If this is a new thread, send the initial message
        if (isNew) {
          const content = await this.messageService.sendInitialMessageToUser(
            userId
          );

          // Also relay the initial message to the staff -- just for transparency
          // so staff knows what the user received, otherwise sometimes forget
          // people get an initial message and less likely to adjust it if needed

          this.messageService.sendInitialMessageToStaff(
            thread.channelId,
            content
          );
        }
      }
    } catch (err) {
      this.logger.error(err, `Error handling DM`);

      // Send an error message to the user
      await message.author.send(
        "An error occurred while processing your message. Please try again later or notify staff in the server."
      );
    }
  }

  async handleUserDMEdit(newMessage: Message): Promise<void> {
    try {
      if (newMessage.channel.type !== ChannelType.DM) {
        return;
      }

      this.logger.debug(`Handling DM edit from ${newMessage.author.tag}`);

      if (newMessage.author.bot) {
        return;
      }

      // Don't create a new thread if it doesn't exist, e.g. if the message was
      // edited after the thread was closed.
      let thread = await this.threadService.getThread(newMessage.author.id);

      if (!thread) {
        return;
      }

      // Relay the edited message to staff
      await this.messageService.relayUserEditedMessageToStaff(
        thread.channelId,
        newMessage
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM edit`);
    }
  }

  async handleUserDMDelete(
    message: OmitPartialGroupDMChannel<Message<boolean> | PartialMessage>
  ): Promise<void> {
    try {
      if (message.channel.type !== ChannelType.DM) {
        return;
      }

      this.logger.debug(
        {
          messageId: message.id,
          channelId: message.channel,
        },
        `Handling DM delete`
      );

      if (message.author?.bot) {
        return;
      }

      // We need the author ID but gateway event only gives us the message ID
      // and channel ID. Since this is in DM, we can get the author ID from the
      // channel which is more reliable.

      // getThread does NOT create a new thread if it doesn't exist. We don't
      // want deleted messages to create new threads in case they were deleted
      // after the thread is closed.
      let thread = await this.threadService.getThread(
        message.channel.recipientId
      );

      if (!thread) {
        return;
      }

      // Relay the deleted message ID to staff
      await this.messageService.relayUserDeletedMessageToStaff(
        thread.channelId,
        message.id
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM delete`);
    }
  }

  async handleUserDMReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (reaction.message.channel.type !== ChannelType.DM) {
        return;
      }

      const emojiIdentifier = reaction.emoji.id || reaction.emoji.name;

      if (!emojiIdentifier) {
        this.logger.debug(
          { reaction },
          `No emoji identifier found for DM reaction`
        );

        return;
      }

      await this.reactionService.relayUserReactionToStaff(
        reaction.message.id,
        emojiIdentifier,
        user.id
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM reaction`);
    }
  }

  async handleUserDMReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (reaction.message.channel.type !== ChannelType.DM) {
        return;
      }

      const emojiIdentifier = reaction.emoji.id || reaction.emoji.name;

      if (!emojiIdentifier) {
        this.logger.debug(
          { reaction },
          `No emoji identifier found for DM reaction removal`
        );

        return;
      }

      await this.reactionService.relayUserReactionRemovalToStaff(
        reaction.message.id,
        emojiIdentifier,
        user.id
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM reaction removal`);
    }
  }
}
