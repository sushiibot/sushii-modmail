import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import { HexColor } from "./Color";
import type { BotEmojiName } from "models/botEmoji.model";

const settingsCustomIDPrefix = "cmd.settings.";
const id = (name: string) => `${settingsCustomIDPrefix}${name}`;

const modalCustomPrefix = "modal.settings.";
const modalId = (name: string) => `${modalCustomPrefix}${name}`;

export const settingsCustomID = {
  prefix: id("prefix"),
  initialMessage: id("initialMessage"),
  forumChannelId: id("forumChannelId"),
  logsChannelId: id("logsChannelId"),
  requiredRoleIds: id("requiredRoleIds"),
  anonymousSnippets: id("anonymousSnippets"),

  // Modals
  modalPrefix: modalId("prefix"),
  modalInitialMessage: modalId("initialMessage"),
};

type MessageEmojis<T extends BotEmojiName> = {
  [K in T]: string;
};

export const SettingsEmojiNames = [
  "logs",
  "message",
  "settings",
  "snippet",
  "tag",
  "message_reply",
  "prefix",
  "channel",
  "staff_user",
  "arrow_down_right",
] as const satisfies readonly BotEmojiName[];

export type SettingsEmojis = MessageEmojis<(typeof SettingsEmojiNames)[number]>;

export class SettingsCommandView {
  static buildMessage(
    config: RuntimeConfig,
    emojis: SettingsEmojis,
    disabled: boolean
  ): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    const headerText = new TextDisplayBuilder();

    let generalSettingsContent = `## ${emojis.settings} Bot Settings`;
    generalSettingsContent += "\n### General Settings";
    generalSettingsContent += `\n${emojis.prefix} **Prefix:** \`${config.prefix}\``;
    generalSettingsContent += `\n${emojis.message_reply} **Initial Message:**`;
    generalSettingsContent += `\n\`\`\`markdown\n${config.initialMessage}\n\`\`\``;

    headerText.setContent(generalSettingsContent);

    container.addTextDisplayComponents(headerText);

    const prefixButton = new ButtonBuilder()
      .setCustomId(settingsCustomID.prefix)
      .setLabel("Change Prefix")
      .setEmoji(emojis.prefix)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled);

    const initialMessageButton = new ButtonBuilder()
      .setCustomId(settingsCustomID.initialMessage)
      .setLabel("Change Initial Message")
      .setEmoji(emojis.message_reply)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);

    const generalActionRow = new ActionRowBuilder<ButtonBuilder>();
    generalActionRow.addComponents(prefixButton, initialMessageButton);

    container.addActionRowComponents(generalActionRow);

    // -------------------------------------------------------------------------
    // Channel Settings

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );

    const channelSettingsText = new TextDisplayBuilder();

    let channelSettingsContent = `### Channel Settings`;

    if (config.forumChannelId === null) {
      channelSettingsContent += `\n${emojis.message} **ModMail Channel:** None`;
    } else {
      channelSettingsContent += `\n${emojis.message} **ModMail Channel:** <#${config.forumChannelId}>`;
    }

    if (config.logsChannelId === null) {
      channelSettingsContent += `\n${emojis.logs} **Error Logs Channel:** None`;
    } else {
      channelSettingsContent += `\n${emojis.logs} **Error Logs Channel:** <#${config.logsChannelId}>`;
    }

    channelSettingsText.setContent(channelSettingsContent);
    container.addTextDisplayComponents(channelSettingsText);

    const forumChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(settingsCustomID.forumChannelId)
      .setChannelTypes(ChannelType.GuildForum)
      .setDefaultChannels(config.forumChannelId ? [config.forumChannelId] : [])
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select a ModMail channel")
      .setDisabled(disabled);

    const logsChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(settingsCustomID.logsChannelId)
      .setDefaultChannels(config.logsChannelId ? [config.logsChannelId] : [])
      .setChannelTypes(
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread
      )
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select an error logs channel")
      .setDisabled(disabled);

    // Only 1 select per row
    const forumChannelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>();
    forumChannelRow.addComponents(forumChannelSelect);
    container.addActionRowComponents(forumChannelRow);

    const logsChannelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>();
    logsChannelRow.addComponents(logsChannelSelect);
    container.addActionRowComponents(logsChannelRow);

    // -------------------------------------------------------------------------
    // Permissions & Roles

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );
    const permissionsText = new TextDisplayBuilder();
    let permissionsContent = "### Permissions";

    if (config.requiredRoleIds.length === 0) {
      permissionsContent += `\n${emojis.staff_user} **Required roles to use commands:** None.`;
      permissionsContent += `\n${emojis.arrow_down_right} **Note:** Commands will requires \`Moderate Members\` permission without roles set.`;
    } else {
      permissionsContent += `\n${emojis.staff_user} **Required roles to use commands (any)**`;
      permissionsContent += `\n`;
      permissionsContent += config.requiredRoleIds
        .map((roleId) => `<@&${roleId}>`)
        .join(", ");
    }

    permissionsText.setContent(permissionsContent);
    container.addTextDisplayComponents(permissionsText);

    const requiredRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId(settingsCustomID.requiredRoleIds)
      .setDefaultRoles(config.requiredRoleIds)
      .setMinValues(0)
      .setMaxValues(10)
      .setPlaceholder("Select roles to allow using commands")
      .setDisabled(disabled);

    const requiredRoleRow = new ActionRowBuilder<RoleSelectMenuBuilder>();
    requiredRoleRow.addComponents(requiredRoleSelect);
    container.addActionRowComponents(requiredRoleRow);

    // -------------------------------------------------------------------------
    // Feature Toggles

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );
    const featureText = new TextDisplayBuilder();
    let featureContent = "### Feature Toggles";
    featureContent += `\n- **Anonymous Snippets:** ${
      config.anonymousSnippets ? "Enabled" : "Disabled"
    }`;
    featureText.setContent(featureContent);
    container.addTextDisplayComponents(featureText);

    const anonymousSnippetsButton = new ButtonBuilder()
      .setCustomId(settingsCustomID.anonymousSnippets)
      .setLabel("Toggle Anonymous Snippets")
      .setEmoji("🕵️‍♀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled);

    const featureActionRow = new ActionRowBuilder<ButtonBuilder>();
    featureActionRow.addComponents(anonymousSnippetsButton);
    container.addActionRowComponents(featureActionRow);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  static prefixModal(currentPrefix: string): ModalBuilder {
    // Use the same custom id for modal and input since there's only 1 anyways
    const modal = new ModalBuilder()
      .setCustomId(settingsCustomID.modalPrefix)
      .setTitle("Change Bot Prefix");

    const prefixInput = new TextInputBuilder()
      .setCustomId(settingsCustomID.modalPrefix)
      .setMinLength(1)
      .setMaxLength(1)
      .setLabel("New Prefix")
      .setRequired(true)
      .setValue(currentPrefix)
      .setPlaceholder("Enter a new prefix")
      .setStyle(TextInputStyle.Short);

    const row = new ActionRowBuilder<TextInputBuilder>();
    row.addComponents(prefixInput);

    modal.addComponents(row);

    return modal;
  }

  static initialMessageModal(currentInitialMessage: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(settingsCustomID.modalInitialMessage)
      .setTitle("Change Initial Message");

    const initialMessageInput = new TextInputBuilder()
      .setCustomId(settingsCustomID.modalInitialMessage)
      .setMinLength(1)
      .setMaxLength(2000)
      .setLabel("New Initial Message")
      .setRequired(true)
      .setValue(currentInitialMessage)
      .setPlaceholder("Enter a new initial message")
      .setStyle(TextInputStyle.Paragraph);

    const row = new ActionRowBuilder<TextInputBuilder>();
    row.addComponents(initialMessageInput);

    modal.addComponents(row);

    return modal;
  }
}
