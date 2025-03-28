import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type {
  MessageRelayService,
  StaffMessageOptions,
} from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

export class EditCommand extends TextCommandHandler {
  commandName = "edit";
  subCommandName = null;

  aliases = ["e"];

  protected forumChannelId: string;
  protected threadService: ThreadService;
  protected messageService: MessageRelayService;

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

    // Check if the message is replying to another message
    const repliedToMessage = msg.reference?.messageId;
    if (!repliedToMessage) {
      await msg.channel.send(
        "To edit a message: Reply to a message with this command and your new message."
      );
      return;
    }

    // TODO: How to tell between relayed user message vs staff message?
    // Both are from bot, both have embeds.

    const editContent = args.join(" ");
    if (!editContent) {
      await msg.channel.send("Please provide a new message content.");
      return;
    }

    try {
      // Get the message that was replied to
      const targetMessage = await msg.channel.messages.fetch(repliedToMessage);

      // Check if the message is from the bot and is an embed (staff message)
      if (targetMessage.author.id !== msg.client.user.id) {
        await msg.channel.send(
          "You can only edit staff messages. Make sure to reply to the bot message you want to edit."
        );

        return;
      }

      // Get thread information from the current channel
      const thread = await this.threadService.getThreadByChannelId(
        msg.channel.id
      );

      if (!thread) {
        await msg.channel.send(
          "Could not find the thread information... hmm... maybe this was a manually created forum thread?"
        );

        return;
      }

      if (thread.isClosed) {
        await msg.channel.send(
          "This thread is closed. Cannot edit messages in a closed thread."
        );
        return;
      }

      // Extract the message options from the original message embed
      const originalEmbed = targetMessage.embeds[0];
      const isAnonymous =
        originalEmbed.author?.name?.includes("Anonymous") || false;
      const isPlainText =
        !originalEmbed.description && targetMessage.content.length > 0;
      const isSnippet = originalEmbed.title?.includes("Snippet") || false;

      const messageOptions: StaffMessageOptions = {
        anonymous: isAnonymous,
        plainText: isPlainText,
        snippet: isSnippet,
      };

      // Edit the message with the new content
      await this.messageService.editStaffMessage(
        repliedToMessage,
        thread.userId,
        msg.guild,
        msg.author,
        editContent,
        messageOptions
      );

      // Send a staff view of the edited message
      const editedEmbed = StaffThreadView.staffReplyEmbed(
        msg.author,
        editContent,
        messageOptions
      );

      editedEmbed.setFooter({ text: `Edited by ${msg.author.username}` });

      // Edit the original message
      await targetMessage.edit({ embeds: [editedEmbed] });

      // Delete the command message
      try {
        await msg.delete();
      } catch (err) {
        // fine
      }
    } catch (error) {
      this.logger.error(`Error editing message: ${error}`);
      await msg.channel.send("Failed to edit message. See logs for details.");
    }
  }
}
