import type { Message } from "discord.js";
import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class ReplyCommand extends BaseReplyCommand {
  commandName = "reply";
  subCommandName = null;
  aliases = ["r"];

  protected replyOptions = {};

  constructor(
    forumChannelId: string,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(forumChannelId, threadService, messageService);
  }
}
