import { ChannelType, Client, Message } from "discord.js";
import { getLogger } from "../utils/logger";
import type { MessageRelayServiceMessage } from "services/MessageRelayService";

export interface MessageRelayService {
  relayUserMessageToStaff(
    channelId: string,
    message: MessageRelayServiceMessage
  ): Promise<boolean>;
}

export interface Thread {
  channelId: string;
}

export interface ThreadService {
  getOrCreateThread(userId: string, username: string): Promise<Thread>;
}

export class DMController {
  private threadService: ThreadService;
  private messageService: MessageRelayService;

  private logger = getLogger("ModmailController");

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    this.threadService = threadService;
    this.messageService = messageService;
  }

  async handleUserDM(client: Client, message: Message): Promise<void> {
    try {
      if (message.channel.type !== ChannelType.DM) {
        return;
      }

      if (message.author.bot) {
        return;
      }

      const userId = message.author.id;
      let thread = await this.threadService.getOrCreateThread(
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
      }
    } catch (error) {
      this.logger.error(`Error handling DM: ${error}`);
    }
  }
}
