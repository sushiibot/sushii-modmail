import type { Message } from "discord.js";
import type { ThreadService } from "services/threadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class ReplyCommand extends BaseReplyCommand {
  name = "reply";
  aliases = ["r"];
  protected replyOptions = {};

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(threadService, messageService);
  }
}
