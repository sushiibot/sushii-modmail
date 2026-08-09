import { ComponentType, type Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import { getLogger } from "utils/logger";
import type { BotManager } from "services/BotManager";
import { BotAdminView } from "views/BotAdmin";

export class AddBotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = "add";
  aliases: string[] = [];
  requiresPrimaryServer = false;
  ownerOnly = true;

  private logger = getLogger(this.constructor.name);
  private botManager: BotManager;

  constructor(botManager: BotManager) {
    super();
    this.botManager = botManager;
  }

  async handler(msg: Message): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const sentMsg = await msg.channel.send(BotAdminView.addPrompt());

    const collector = sentMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 2 * 60 * 1000,
      filter: (interaction) => interaction.user.id === msg.author.id,
    });

    collector.on("collect", async (interaction) => {
      await interaction.showModal(BotAdminView.addModal()).catch((err: unknown) => {
        this.logger.warn(err, "Failed to show add-bot modal");
      });
    });

    collector.on("end", () => {
      const { content, components } = BotAdminView.addPrompt(true);
      sentMsg.edit({ content, components }).catch((err: unknown) => {
        this.logger.warn(err, "Failed to disable expired add-bot prompt");
      });
    });
  }
}
