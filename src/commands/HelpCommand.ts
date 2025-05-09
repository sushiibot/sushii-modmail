import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import { getLogger } from "utils/logger";
import { HelpCommandView } from "views/HelpView";

export class HelpCommand extends TextCommandHandler {
  commandName = "help";
  subCommandName = null;
  aliases = [];

  private logger = getLogger("CloseCommand");

  constructor() {
    super();
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const helpMsg = HelpCommandView.help();
    await msg.reply(helpMsg);
  }
}
