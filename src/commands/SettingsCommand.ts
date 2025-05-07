import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import { getLogger } from "utils/logger";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import { SettingsCommandView } from "views/Settings";

interface ConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
}

export class SettingsCommand extends TextCommandHandler {
  commandName = "settings";
  subCommandName = null;
  aliases = ["setup"];

  private configRepository: ConfigRepository;

  private logger = getLogger("SettingsCommand");

  constructor(configRepository: ConfigRepository) {
    super();

    this.configRepository = configRepository;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const config = await this.configRepository.getConfig(msg.guildId);

    this.logger.debug(
      {
        guildId: msg.guildId,
        config,
      },
      "Settings command invoked"
    );

    const settingsMsg = SettingsCommandView.buildMessage(config);
    await msg.channel.send(settingsMsg);
  }
}
