import { ChannelType, Client, Message } from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";
import type { StaffViewUserMessage } from "views/StaffThreadView";

export interface MessageRelayService {
  relayUserMessageToStaff(
    channelId: string,
    message: StaffViewUserMessage
  ): Promise<boolean>;
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
}

export class DMController {
  private threadService: ThreadService;
  private messageService: MessageRelayService;

  private logger: Logger;

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    this.threadService = threadService;
    this.messageService = messageService;

    this.logger = getLogger("ModmailController");
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
}
