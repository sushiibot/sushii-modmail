import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import { getLogger } from "utils/logger";
import { SettingsService } from "services/SettingsService";
import type { BotConfig } from "models/botConfig.model";
import { SettingsErrorView } from "views/SettingsErrorView";

export class SettingsCommand extends TextCommandHandler {
  commandName = "settings";
  subCommandName = null;
  aliases = ["setup"];

  private settingsService: SettingsService;
  private config: BotConfig;
  private logger = getLogger("SettingsCommand");

  constructor(settingsService: SettingsService, config: BotConfig) {
    super();

    this.settingsService = settingsService;
    this.config = config;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    if (msg.guildId !== this.config.guildId) {
      const guild = msg.client.guilds.cache.get(this.config.guildId);
      const name = guild?.name ?? "Unknown";

      const errorMessage = SettingsErrorView.primaryServerOnlyError(name, this.config.guildId);
      await msg.channel.send(errorMessage);
      return;
    }

    return this.settingsService.showSettings(msg);
  }
}
