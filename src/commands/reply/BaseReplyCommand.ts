import type { Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type {
  MessageRelayService,
  StaffMessageOptions,
} from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

export abstract class BaseReplyCommand extends TextCommandHandler {
  protected forumChannelId: string;
  protected threadService: ThreadService;
  protected messageService: MessageRelayService;

  protected abstract replyOptions: StaffMessageOptions;

  protected logger = getLogger(this.constructor.name);

  constructor(
    forumChannelId: string,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super();

    this.forumChannelId = forumChannelId;
    this.threadService = threadService;
    this.messageService = messageService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    // Check if the message is in a modmail thread
    if (msg.channel.parentId !== this.forumChannelId) {
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

    if (thread.isClosed) {
      await msg.channel.send(
        "This thread is closed and cannot be replied to. Open a new thread to continue."
      );

      // Re-lock -- should always be a thread from the check above, but need type check
      if (msg.channel.isThread()) {
        await msg.channel.edit({
          locked: true,
          archived: true,
        });
      }

      return;
    }

    try {
      // Send the reply to the user
      await this.messageService.relayStaffMessageToUser(
        thread.userId,
        msg.guild,
        msg.author,
        replyContent,
        this.replyOptions
      );

      // Re-send as embed to show the message was sent and how it looks
      const embed = StaffThreadView.staffReplyEmbed(
        msg.author,
        replyContent,
        this.replyOptions
      );

      await Promise.allSettled([
        // Delete the original message
        msg.delete(),
        msg.channel.send({
          embeds: [embed],
        }),
      ]);
    } catch (error) {
      this.logger.error(`Error sending reply: ${error}`);
      await msg.channel.send("Failed to send reply. See logs for details.");
    }
  }
}
