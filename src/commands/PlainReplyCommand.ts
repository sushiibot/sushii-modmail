import type { Message } from "discord.js";
import type { ThreadService } from "services/threadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class PlainReplyCommand extends BaseReplyCommand {
  name = "preply";
  aliases = ["pr"];
  protected replyOptions = { plainText: true };

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(threadService, messageService);
  }
}
