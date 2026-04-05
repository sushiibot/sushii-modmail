import {
  ChannelType,
  Client,
  Message,
  type OmitPartialGroupDMChannel,
  type PartialMessage,
} from "discord.js";
import { getLogger } from "../utils/logger";
import type { UserToStaffMessage } from "../models/relayMessage";
import type { LogService } from "../services/LogService";
import { tracer } from "../tracing";
import { SpanStatusCode } from "@opentelemetry/api";

export interface MessageRelayService {
  relayUserMessageToStaff(
    threadId: string,
    message: UserToStaffMessage
  ): Promise<boolean>;
  relayUserEditedMessageToStaff(
    threadId: string,
    message: UserToStaffMessage
  ): Promise<void>;
  relayUserDeletedMessageToStaff(
    threadId: string,
    messageId: string
  ): Promise<void>;
  sendInitialMessageToUser(userId: string): Promise<string>;
  sendInitialMessageToStaff(channelId: string, content: string): Promise<void>;
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
  private logService: LogService;

  private logger = getLogger(this.constructor.name);

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService,
    logService: LogService
  ) {
    this.threadService = threadService;
    this.messageService = messageService;
    this.logService = logService;
  }

  async handleUserDM(client: Client, message: Message): Promise<void> {
    if (message.channel.type !== ChannelType.DM) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    const userId = message.author.id;
    const forwarded = message.messageSnapshots.size > 0;

    // Not using withSpan here: the catch block handles errors gracefully
    // (logs + notifies the user) without re-throwing, so withSpan's re-throw
    // would change the behaviour. We record the exception manually instead.
    await tracer.startActiveSpan("dm.receive", async (span) => {
      span.setAttributes({
        "user.id": userId,
        "message.forwarded": forwarded,
      });

      try {
        this.logger.debug(`Handling DM from ${message.author.tag}`);

        let { thread, isNew } = await this.threadService.getOrCreateThread(
          userId,
          message.author.username
        );

        span.setAttributes({
          "thread.id": thread.channelId,
          "thread.is_new": isNew,
        });

        let success = false;

        if (forwarded) {
          // Forwarded message
          const snapshot = message.messageSnapshots.first()!;

          success = await this.messageService.relayUserMessageToStaff(
            thread.channelId,
            {
              // ThreadDB stores main message ID, not forwarded message ID
              id: message.id,
              author: message.author,
              // Only use snapshot for the content itself
              content: snapshot.content,
              attachments: Array.from(snapshot.attachments.values()),
              stickers: Array.from(snapshot.stickers.values()),
              // Mark as forwarded
              forwarded: true,
              createdTimestamp: message.createdTimestamp,
            }
          );
        } else {
          // Normal message
          success = await this.messageService.relayUserMessageToStaff(
            thread.channelId,
            {
              ...message,
              attachments: Array.from(message.attachments.values()),
              stickers: Array.from(message.stickers.values()),
            }
          );
        }

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
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });

        const contextMsg = `Error handling DM from ${
          message.author?.tag || "unknown user"
        }`;

        try {
          // Log to both Discord and console via logService, include user's message
          await this.logService.logError(err, contextMsg, this.constructor.name, message.content);

          // Send an error message to the user
          await message.author.send(
            "An error occurred while processing your message. Please try again later or notify staff in the server."
          );
        } catch (notifyErr) {
          // Last-resort console log so errors are never silently swallowed
          this.logger.error({ err, notifyErr }, contextMsg);
        }
      } finally {
        span.end();
      }
    });
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
        {
          ...newMessage,
          attachments: Array.from(newMessage.attachments.values()),
          stickers: Array.from(newMessage.stickers.values()),
        }
      );
    } catch (err) {
      const contextMsg = `Error handling DM edit from ${
        newMessage.author?.tag || "unknown user"
      }`;

      await this.logService.logError(err, contextMsg, this.constructor.name, newMessage.content);
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
      const contextMsg = `Error handling DM delete for message ${message.id}`;

      await this.logService.logError(err, contextMsg, this.constructor.name);
    }
  }
}
