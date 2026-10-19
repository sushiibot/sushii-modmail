import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Message,
  type User,
} from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { StaffThreadView } from "views/StaffThreadView";

export class ContactCommand extends TextCommandHandler {
  commandName = "contact";
  subCommandName = null;
  aliases = ["open"];
  requiresPrimaryServer = true;

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

    // Creates a new thread as staff to contact specific members. Parse the
    // target from args[0] rather than msg.mentions, since a bot @mention
    // prefix would otherwise be picked up as the target.
    const match = args[0]?.match(/^<@!?(\d{17,20})>$|^(\d{17,20})$/);
    const targetUserId = match?.[1] ?? match?.[2];
    if (!targetUserId) {
      await msg.channel.send("Usage: contact <@user | user ID>");
      return;
    }

    let targetUser: User;
    try {
      targetUser = await msg.client.users.fetch(targetUserId);
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        (err.code === RESTJSONErrorCodes.UnknownUser ||
          err.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType)
      ) {
        await msg.channel.send("Could not find a user with that ID.");
        return;
      }

      throw err;
    }

    if (targetUser.bot) {
      await msg.channel.send("You cannot open a thread with a bot.");
      return;
    }

    const { thread, isNew } = await this.threadService.getOrCreateThread(
      targetUser.id,
      targetUser.username,
      true, // force silent notification role
      "staff_contact"
    );

    if (!isNew) {
      const content = `There's already a thread open with this user: ${thread.link}`;
      await msg.channel.send(content);

      return;
    }

    // Send a message to the staff to link the thread
    await msg.channel.send(`Created a new thread: ${thread.link}`);
  }
}
