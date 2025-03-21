import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/threadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { getLogger } from "utils/logger";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class AnonymousReplyCommand extends BaseReplyCommand {
  name = "areply";
  aliases = ["ar"];
  protected replyOptions = { anonymous: true };

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(threadService, messageService);
  }
}
