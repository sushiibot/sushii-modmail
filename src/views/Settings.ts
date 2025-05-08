import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import { HexColor } from "./Color";
import type { BotEmojiName } from "models/botEmoji.model";

const SettingsCustomID = {
  prefix: "prefix",
  initialMessage: "initialMessage",
  forumChannelId: "forumChannelId",
  logsChannelId: "logsChannelId",
  requiredRoleIds: "requiredRoleIds",
  anonymousSnippets: "anonymousSnippets",
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
] as const satisfies readonly BotEmojiName[];

export type SettingsEmojis = MessageEmojis<(typeof SettingsEmojiNames)[number]>;

export class SettingsCommandView {
  static buildMessage(
    config: RuntimeConfig,
    emojis: SettingsEmojis
  ): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    // Modals
    // - prefix
    // - initialMessage

    // Select menus
    // - forumChannelId
    // - logsChannelId
    // - requiredRoleIds

    // Button
    // - anonymousSnippets

    const headerText = new TextDisplayBuilder();

    let generalSettingsContent = `## ${emojis.settings} Bot Settings`;
    generalSettingsContent += "\n### General Settings";
    generalSettingsContent += `\n${emojis.prefix} **Prefix:** \`${config.prefix}\``;
    generalSettingsContent += `\n${emojis.message_reply} **Initial Message:**`;
    generalSettingsContent += `\n\`\`\`markdown\n${config.initialMessage}\n\`\`\``;

    headerText.setContent(generalSettingsContent);

    container.addTextDisplayComponents(headerText);

    const prefixButton = new ButtonBuilder()
      .setCustomId(SettingsCustomID.prefix)
      .setLabel("Change Prefix")
      .setEmoji("💬")
      .setStyle(ButtonStyle.Primary);

    const initialMessageButton = new ButtonBuilder()
      .setCustomId(SettingsCustomID.initialMessage)
      .setLabel("Change Initial Message")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Secondary);

    const generalActionRow = new ActionRowBuilder<ButtonBuilder>();
    generalActionRow.addComponents(prefixButton, initialMessageButton);

    container.addActionRowComponents(generalActionRow);

    // -------------------------------------------------------------------------
    // Channel Settings

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );

    const channelSettingsText = new TextDisplayBuilder();

    let channelSettingsContent = `### ${emojis.channel} Channel Settings`;

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
      .setCustomId(SettingsCustomID.forumChannelId)
      .setChannelTypes(ChannelType.GuildForum)
      .setDefaultChannels(config.forumChannelId ? [config.forumChannelId] : [])
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select a ModMail channel");

    const logsChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(SettingsCustomID.logsChannelId)
      .setDefaultChannels(config.logsChannelId ? [config.logsChannelId] : [])
      .setChannelTypes(
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread
      )
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select an error logs channel");

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
      permissionsContent += `\n${emojis.staff_user} **Required roles to use commands:** None. Default requires \`Moderate Members\` permission.`;
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
      .setCustomId(SettingsCustomID.requiredRoleIds)
      .setDefaultRoles(config.requiredRoleIds)
      .setMinValues(0)
      .setMaxValues(10)
      .setPlaceholder("Select roles to allow using commands");

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
      .setCustomId(SettingsCustomID.anonymousSnippets)
      .setLabel("Toggle Anonymous Snippets")
      .setEmoji("🕵️‍♀️")
      .setStyle(ButtonStyle.Secondary);

    const featureActionRow = new ActionRowBuilder<ButtonBuilder>();
    featureActionRow.addComponents(anonymousSnippetsButton);
    container.addActionRowComponents(featureActionRow);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
}
