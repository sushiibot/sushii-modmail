import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "../views/StaffThreadView";

export class LogsCommand extends TextCommandHandler {
  commandName = "logs";
  subCommandName = null;
  aliases = [];

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

    // If the message is not in a thread, require arg to be a user to look up
    if (!msg.channel.isThread()) {
      if (args.length === 0) {
        await msg.channel.send(
          "Please provide a user ID to look up their threads."
        );

        return;
      }

      const userId = args[0];

      // Find all previous threads by the same user
      const threads = await this.threadService.getAllThreadsByUserId(userId);

      // Format and show links to all previous threads
      const formattedThreads = StaffThreadView.formatThreadList(threads);
      await msg.channel.send(formattedThreads);

      return;
    }

    // Check if the message is in a modmail thread
    if (msg.channel.parentId !== this.forumChannelId) {
      return;
    }

    // Get thread information from the current channel
    const thread = await this.threadService.getThreadByChannelId(
      msg.channel.id
    );

    if (!thread) {
      await msg.channel.send("Thread not found somehow.");
      return;
    }

    // Find all previous threads by the same user
    const threads = await this.threadService.getAllThreadsByUserId(
      thread.userId
    );

    // Format and show links to all previous threads
    const formattedThreads = StaffThreadView.formatThreadList(threads);
    await msg.channel.send(formattedThreads);
  }
}
