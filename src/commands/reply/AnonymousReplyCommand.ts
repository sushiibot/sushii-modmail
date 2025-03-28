import type { ThreadService } from "services/ThreadService";
import {
  defaultStaffMessageOptions,
  type MessageRelayService,
} from "services/MessageRelayService";
import { BaseReplyCommand } from "./BaseReplyCommand";

export class AnonymousReplyCommand extends BaseReplyCommand {
  commandName = "areply";
  subCommandName = null;
  aliases = ["ar"];

  protected replyOptions = {
    ...defaultStaffMessageOptions,
    anonymous: true,
  };

  constructor(
    forumChannelId: string,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    super(forumChannelId, threadService, messageService);
  }
}
