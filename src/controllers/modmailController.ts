import { ChannelType, Client, Message } from "discord.js";
import { ThreadService } from "../services/threadService";
import { MessageService } from "../services/messageService";
import { getLogger } from "../utils/logger";

export class ModmailController {
  private threadService: ThreadService;
  private messageService: MessageService;
  private logger = getLogger("ModmailController");

  constructor(threadService: ThreadService, messageService: MessageService) {
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
        client,
        userId,
        message.author.username
      );

      await this.messageService.relayUserMessageToStaff(
        client,
        thread.channelId,
        message
      );
    } catch (error) {
      this.logger.error(`Error handling DM: ${error}`);
    }
  }
}
