import type { ThreadService } from "services/ThreadService";
import type { MessageRelayService } from "services/MessageRelayService";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class AnonymousReplyCommand extends BaseReplyCommand {
  commandName = "areply";
  subCommandName = null;
  aliases = ["ar"];

  protected replyOptions = { anonymous: true };

  constructor(
    forumChannelId: string,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(forumChannelId, threadService, messageService);
  }
}
