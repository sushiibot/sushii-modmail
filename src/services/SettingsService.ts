import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  Interaction,
  Message,
  MessageCreateOptions,
} from "discord.js";
import { getLogger } from "utils/logger";
import {
  SettingsCommandView,
  settingsCustomID,
  SettingsEmojiNames,
  type SettingsEmojis,
} from "views/Settings";
import type { BotEmojiRepository } from "repositories/botEmoji.repository";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import type { UpdateConfig } from "repositories/runtimeConfig.repository";

export interface ConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
  setConfig(guildId: string, changes: UpdateConfig): Promise<RuntimeConfig>;
  toggleAnonymousSnippets(guildId: string): Promise<RuntimeConfig>;
}

export class SettingsService {
  private configRepository: ConfigRepository;
  private emojiRepository: BotEmojiRepository;
  private logger = getLogger(this.constructor.name);

  constructor(
    configRepository: ConfigRepository,
    emojiRepository: BotEmojiRepository
  ) {
    this.configRepository = configRepository;
    this.emojiRepository = emojiRepository;
  }

  async buildSettingsMessage(
    config: RuntimeConfig,
    disabled: boolean = false
  ): Promise<MessageCreateOptions> {
    // Fetch required emojis
    const emojis = await this.emojiRepository.getEmojis([
      ...SettingsEmojiNames,
    ]);

    // Check if all emojis are available, and convert to emoji strings
    const emojiMap = {} as SettingsEmojis;
    for (const name of SettingsEmojiNames) {
      const found = emojis.find((e) => e.name === name);
      if (!found) {
        this.logger.error({ name }, `Emoji not found in database: ${name}`);
      }

      emojiMap[name] = found ? found.toEmojiString() : "";
    }

    this.logger.debug(
      { emojis: emojiMap },
      "Fetched emojis for settings command"
    );

    // Build settings message
    return SettingsCommandView.buildMessage(config, emojiMap, disabled);
  }

  async showSettings(msg: Message<true>): Promise<void> {
    try {
      const config: RuntimeConfig = await this.configRepository.getConfig(
        msg.guildId
      );

      const settingsMsg = await this.buildSettingsMessage(config);
      const sentMsg = await msg.channel.send(settingsMsg);

      this.logger.debug(
        { settingsMsg, sentMsg },
        "Sent settings message, listening for interactions"
      );

      // Listen for settings changes
      const collector = sentMsg.createMessageComponentCollector({
        // 2 minutes
        time: 2 * 60 * 1000,
      });

      collector.on("collect", async (interaction) => {
        this.logger.debug(
          {
            interaction: interaction.id,
            type: interaction.type,
            userId: interaction.user.id,
            userName: interaction.user.username,
            guildId: msg.guildId,
          },
          "Received interaction for settings"
        );

        if (interaction.user.id !== msg.author.id) {
          await interaction.reply({
            content: "Only the person who invoked this command can use it.",
            ephemeral: true,
          });

          return;
        }

        await this.editSettings(interaction, config);
      });

      await new Promise<void>((resolve) =>
        collector.once("end", () => resolve())
      );

      // Disable buttons after collector ends
      const { flags, ...disabledMsg } = await this.buildSettingsMessage(
        config,
        true
      );
      await sentMsg.edit(disabledMsg);
    } catch (err: any) {
      this.logger.error(err, "Failed to execute settings service");
    }
  }

  async editSettingsMessage(
    interaction:
      | AnySelectMenuInteraction<"cached">
      | ButtonInteraction<"cached">
  ): Promise<void> {
    const config: RuntimeConfig = await this.configRepository.getConfig(
      interaction.guildId
    );

    // Exclude flags for edit
    const { flags, ...createMsg } = await this.buildSettingsMessage(config);
    await interaction.update(createMsg);
  }

  // Handler for button interactions
  private async handleButton(
    interaction: ButtonInteraction<"cached">,
    currentConfig: RuntimeConfig
  ) {
    switch (interaction.customId) {
      case settingsCustomID.prefix:
        return interaction.showModal(
          SettingsCommandView.prefixModal(currentConfig.prefix)
        );
      case settingsCustomID.initialMessage:
        return interaction.showModal(
          SettingsCommandView.initialMessageModal(currentConfig.initialMessage)
        );
      case settingsCustomID.anonymousSnippets:
        await this.configRepository.toggleAnonymousSnippets(
          interaction.guildId
        );

        // Only this one has to be updated, no modal
        return this.editSettingsMessage(interaction);
      default:
        return;
    }
  }

  // Handler for channel select menu interactions
  private async handleChannelMenu(
    interaction: AnySelectMenuInteraction<"cached">
  ) {
    switch (interaction.customId) {
      case settingsCustomID.forumChannelId:
        if (!interaction.values.length) {
          this.logger.warn(
            "No channel selected for select menu, should not happen with minimum 1"
          );

          await interaction.reply({
            content: "No forum channel selected. Please select a channel.",
            ephemeral: true,
          });
          return;
        }

        await this.configRepository.setConfig(interaction.guildId, {
          forumChannelId: interaction.values[0],
        });
        break;
      case settingsCustomID.logsChannelId:
        if (!interaction.values.length) {
          this.logger.warn(
            "No channel selected for select menu, should not happen with minimum 1"
          );

          await interaction.reply({
            content: "No logs channel selected. Please select a channel.",
            ephemeral: true,
          });
          return;
        }

        await this.configRepository.setConfig(interaction.guildId, {
          logsChannelId: interaction.values[0],
        });
        break;
      default:
        return;
    }

    // Update the message with new settings
    return this.editSettingsMessage(interaction);
  }

  // Handler for role select menu interactions
  private async handleRoleMenu(
    interaction: AnySelectMenuInteraction<"cached">
  ) {
    if (interaction.customId !== settingsCustomID.requiredRoleIds) {
      return;
    }

    await this.configRepository.setConfig(interaction.guildId, {
      requiredRoleIds: interaction.values,
    });
    return this.editSettingsMessage(interaction);
  }

  async editSettings(
    interaction: Interaction<"cached">,
    currentConfig: RuntimeConfig
  ): Promise<void> {
    if (interaction.isButton()) {
      return this.handleButton(interaction, currentConfig);
    }

    if (interaction.isChannelSelectMenu()) {
      return this.handleChannelMenu(interaction);
    }

    if (interaction.isRoleSelectMenu()) {
      return this.handleRoleMenu(interaction);
    }
  }
}
