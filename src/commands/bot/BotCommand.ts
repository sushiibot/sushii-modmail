import type { Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import { BotAdminView } from "views/BotAdmin";

/**
 * Parent `bot` handler -- exists so CommandRouter.getCommandNames() sees a
 * real handler for "bot" (a bare parent-only entry with handler: null is
 * skipped there), which is what reserves "bot" against snippet creation.
 * Reached directly only when no subcommand is given.
 */
export class BotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = null;
  aliases: string[] = [];
  requiresPrimaryServer = false;
  ownerOnly = true;

  async handler(msg: Message): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    await msg.channel.send(BotAdminView.help());
  }
}
