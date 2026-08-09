import type { Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import type { BotManager } from "services/BotManager";
import { BotAdminView } from "views/BotAdmin";

export class ListBotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = "list";
  aliases: string[] = [];
  requiresPrimaryServer = false;
  ownerOnly = true;

  private botManager: BotManager;

  constructor(botManager: BotManager) {
    super();
    this.botManager = botManager;
  }

  async handler(msg: Message): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const summaries = this.botManager.getSummaries();
    await msg.channel.send(BotAdminView.list(summaries));
  }
}
