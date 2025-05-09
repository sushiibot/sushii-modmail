import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import { getLogger } from "utils/logger";
import { SettingsService } from "services/SettingsService";

export class SettingsCommand extends TextCommandHandler {
  commandName = "settings";
  subCommandName = null;
  aliases = ["setup"];

  private settingsService: SettingsService;

  constructor(settingsService: SettingsService) {
    super();

    this.settingsService = settingsService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    return this.settingsService.showSettings(msg);
  }
}
