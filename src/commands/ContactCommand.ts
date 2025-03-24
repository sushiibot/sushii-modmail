import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

export abstract class ContactCommand extends TextCommandHandler {
  protected threadService: ThreadService;
  protected messageService: MessageRelayService;

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

    // Creates a new thread as staff to contact specific members
    const userId = args[0];

    const { thread, isNew } = await this.threadService.getOrCreateThread(
      userId,
      msg.author.tag
    );

    if (!isNew) {
      const content = `There's already a thread open with this user: ${thread.link}`;
      await msg.channel.send(content);

      return;
    }

    // Send a message to the staff to link the thread
    await msg.channel.send(thread.link);
  }
}
