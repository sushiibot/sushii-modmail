import { ComponentType, type Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import { getLogger } from "utils/logger";
import type { BotManager } from "services/BotManager";
import type { BotRepository } from "repositories/bot.repository";
import { BotAdminView } from "views/BotAdmin";

export class RotateBotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = "rotate";
  aliases: string[] = [];
  requiresPrimaryServer = false;
  ownerOnly = true;

  private logger = getLogger(this.constructor.name);
  private botManager: BotManager;
  private botRepository: BotRepository;

  constructor(botManager: BotManager, botRepository: BotRepository) {
    super();
    this.botManager = botManager;
    this.botRepository = botRepository;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const name = args[0];
    if (!name) {
      await msg.channel.send("Usage: `bot rotate <name>`");
      return;
    }

    const entry = await this.botRepository.findByName(name);
    if (!entry) {
      await msg.channel.send(`No bot named \`${name}\`.`);
      return;
    }

    const sentMsg = await msg.channel.send(
      BotAdminView.rotatePrompt(entry.name, entry.applicationId)
    );

    const collector = sentMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 2 * 60 * 1000,
      filter: (interaction) => interaction.user.id === msg.author.id,
    });

    collector.on("collect", async (interaction) => {
      await interaction
        .showModal(BotAdminView.rotateModal(entry.name, entry.applicationId))
        .catch((err: unknown) => {
          this.logger.warn(err, "Failed to show rotate-bot modal");
        });
    });

    collector.on("end", () => {
      const { content, components } = BotAdminView.rotatePrompt(
        entry.name,
        entry.applicationId,
        true
      );
      sentMsg.edit({ content, components }).catch((err: unknown) => {
        this.logger.warn(err, "Failed to disable expired rotate-bot prompt");
      });
    });
  }
}
