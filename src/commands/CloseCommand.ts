import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import { getLogger } from "utils/logger";

export class CloseCommand extends TextCommandHandler {
  commandName = "close";
  subCommandName = null;
  aliases = ["c"];

  private forumChannelId: string;
  private threadService: ThreadService;
  private logger = getLogger("CloseCommand");

  constructor(forumChannelId: string, threadService: ThreadService) {
    super();
    this.forumChannelId = forumChannelId;
    this.threadService = threadService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    // Check if the message is in a modmail thread
    if (
      !msg.channel.isThread() ||
      msg.channel.parentId !== this.forumChannelId
    ) {
      await msg.channel.send(
        "This command can only be used in a modmail thread channel."
      );

      return;
    }

    // Get thread information from the current channel
    const thread = await this.threadService.getThreadByChannelId(
      msg.channel.id
    );

    if (!thread) {
      await msg.channel.send(
        "Hmm... couldn't find the thread information, maybe this was a manually created forum thread."
      );

      return;
    }

    if (thread.isClosed) {
      await msg.channel.send("This thread is already closed.");
      return;
    }

    try {
      // Close the thread
      await this.threadService.closeThread(thread, msg.author.id);
    } catch (error) {
      this.logger.error(`Error closing thread: ${error}`);

      await msg.channel.send(
        "Failed to close the thread. See logs for details."
      );
    }
  }
}
