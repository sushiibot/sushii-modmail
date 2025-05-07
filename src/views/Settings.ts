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
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import { HexColor } from "./Color";

const SettingsCustomID = {
  prefix: "prefix",
  initialMessage: "initialMessage",
  forumChannelId: "forumChannelId",
  logsChannelId: "logsChannelId",
  requiredRoleIds: "requiredRoleIds",
  anonymousSnippets: "anonymousSnippets",
};

export class SettingsCommandView {
  static buildMessage(config: RuntimeConfig): MessageCreateOptions {
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

    let generalSettingsContent = "## Bot Settings";
    generalSettingsContent += "\n### General Settings";
    generalSettingsContent += `\n- **Prefix:** \`${config.prefix}\``;
    generalSettingsContent += `\n- **Initial Message:**`;
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

    container.addSeparatorComponents(new SeparatorBuilder());

    const channelSettingsText = new TextDisplayBuilder();

    let channelSettingsContent = "### Channel Settings";

    if (config.forumChannelId === null) {
      channelSettingsContent += `\n- **ModMail Channel:** None`;
    } else {
      channelSettingsContent += `\n- **ModMail Channel:** <#${config.forumChannelId}>`;
    }

    if (config.logsChannelId === null) {
      channelSettingsContent += `\n- **Error Logs Channel:** None`;
    } else {
      channelSettingsContent += `\n- **Error Logs Channel:** <#${config.logsChannelId}>`;
    }

    channelSettingsText.setContent(channelSettingsContent);
    container.addTextDisplayComponents(channelSettingsText);

    const forumChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(SettingsCustomID.forumChannelId)
      .setChannelTypes(ChannelType.GuildForum)
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select a ModMail channel");

    const logsChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(SettingsCustomID.logsChannelId)
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

    container.addSeparatorComponents(new SeparatorBuilder());
    const permissionsText = new TextDisplayBuilder();
    let permissionsContent = "### Permissions";

    if (config.requiredRoleIds.length === 0) {
      permissionsContent += `\n- **Required roles to use commands:** None. Default requires \`Moderate Members\` permission.`;
    } else {
      permissionsContent += `\n- **Required roles to use commands (any)** ${config.requiredRoleIds
        .map((roleId) => `<@&${roleId}>`)
        .join(", ")}`;
    }

    permissionsText.setContent(permissionsContent);
    container.addTextDisplayComponents(permissionsText);

    const requiredRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId(SettingsCustomID.requiredRoleIds)
      .setMinValues(0)
      .setMaxValues(10)
      .setPlaceholder("Select roles to allow using commands");

    const requiredRoleRow = new ActionRowBuilder<RoleSelectMenuBuilder>();
    requiredRoleRow.addComponents(requiredRoleSelect);
    container.addActionRowComponents(requiredRoleRow);

    // -------------------------------------------------------------------------
    // Feature Toggles

    container.addSeparatorComponents(new SeparatorBuilder());
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
