import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type {
  MessageRelayService,
  StaffMessageOptions,
} from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

export abstract class BaseReplyCommand extends TextCommandHandler {
  protected threadService: ThreadService;
  protected messageService: MessageRelayService;
  protected abstract replyOptions: StaffMessageOptions;

  protected logger = getLogger(this.constructor.name);

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super();
    this.threadService = threadService;
    this.messageService = messageService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    // Check if the message is in a modmail thread
    if (msg.channel.parentId !== process.env.MODMAIL_FORUM_ID) {
      return;
    }

    const replyContent = args.join(" ");
    if (!replyContent) {
      await msg.channel.send("Please provide a message to reply with.");
      return;
    }

    // Get thread information from the current channel
    const thread = await this.threadService.getThreadByChannelId(
      msg.channel.id
    );

    if (!thread) {
      await msg.channel.send(
        "This command can only be used in a modmail thread channel."
      );
      return;
    }

    try {
      // Send the reply to the user
      await this.messageService.relayStaffMessageToUser(
        msg.client,
        thread.userId,
        msg.guild,
        msg.author,
        replyContent,
        this.replyOptions
      );

      // Delete the original message
      await msg.delete();

      // Re-send as embed to show the message was sent and how it looks
      const embed = StaffThreadView.staffReplyEmbed(
        msg.author,
        replyContent,
        this.replyOptions
      );
      await msg.channel.send({
        embeds: [embed],
      });
    } catch (error) {
      this.logger.error(`Error sending reply: ${error}`);
      await msg.channel.send("Failed to send reply. See logs for details.");
    }
  }
}
