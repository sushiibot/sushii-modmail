import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
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
