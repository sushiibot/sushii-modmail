import type { Message } from "discord.js";
import TextCommandHandler from "./CommandHandler";
import type { ThreadService } from "services/ThreadService";
import { getLogger } from "utils/logger";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import {
  SettingsCommandView,
  SettingsEmojiNames,
  type SettingsEmojis,
} from "views/Settings";
import type { BotEmojiRepository } from "repositories/botEmoji.repository";

interface ConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
}

export class SettingsCommand extends TextCommandHandler {
  commandName = "settings";
  subCommandName = null;
  aliases = ["setup"];

  private configRepository: ConfigRepository;
  private emojiRepository: BotEmojiRepository;

  private logger = getLogger("SettingsCommand");

  constructor(
    configRepository: ConfigRepository,
    emojiRepository: BotEmojiRepository
  ) {
    super();

    this.configRepository = configRepository;
    this.emojiRepository = emojiRepository;
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

    const emojis = await this.emojiRepository.getEmojis([
      ...SettingsEmojiNames,
    ]);

    // Convert to map
    const emojiMap: SettingsEmojis = {} as SettingsEmojis;
    for (const name of SettingsEmojiNames) {
      const found = emojis.find((e) => e.name === name);
      if (!found) {
        this.logger.warn(
          {
            name,
          },
          `Emoji not found: ${name}`
        );
      }

      emojiMap[name] = found ? found.toEmojiString() : "";
    }

    const settingsMsg = SettingsCommandView.buildMessage(config, emojiMap);
    await msg.channel.send(settingsMsg);
  }
}
