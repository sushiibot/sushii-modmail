import {
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type Message,
} from "discord.js";
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
    // If ALL are empty, return
    if (
      !replyContent &&
      msg.attachments.size === 0 &&
      msg.stickers.size === 0
    ) {
      await msg.channel.send(
        "Please provide a message or attachment to reply with."
      );
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
      // Update message content to be the reply only, not full command
      msg.content = replyContent;

      // Send the reply to the user
      const relay = await this.messageService.relayStaffMessageToUser(
        thread.userId,
        msg.guild,
        msg,
        this.replyOptions
      );

      const relayedMsgId = relay.msgId;

      // Re-send to show the message was sent and how it looks
      const components = StaffThreadView.staffReplyComponents(
        msg,
        this.replyOptions
      );

      const threadStaffMsg = await msg.channel.send({
        components,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });

      await this.messageService.saveStaffMessage({
        threadId: thread.channelId,
        threadMessageId: threadStaffMsg.id,
        relayedMessageId: relayedMsgId,
        authorId: msg.author.id,
        content: replyContent,
        isAnonymous: this.replyOptions.anonymous,
        isPlainText: this.replyOptions.plainText,
        isSnippet: this.replyOptions.snippet,
      });

      // TODO: Clear error for if bot missing MANAGE_MESSAGES permission
      try {
        await msg.delete();
      } catch (err) {
        if (
          err instanceof DiscordAPIError &&
          err.code === RESTJSONErrorCodes.MissingPermissions
        ) {
          await msg.channel.send(
            "If you want the original reply commands to be automatically deleted, please ensure I have the `Manage Messages` permission in this channel."
          );
        }

        this.logger.error(
          `Error deleting command message: ${err} -- ${msg.content}`
        );
      }
    } catch (error) {
      this.logger.error(`Error sending reply: ${error}`);

      await msg.channel.send(
        "Error while sending reply. See logs for details."
      );
    }
  }
}
