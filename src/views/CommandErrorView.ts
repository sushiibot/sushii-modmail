import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { HexColor } from "./Color";

export class CommandErrorView {
  static primaryServerOnlyError(
    primaryGuildName: string,
    primaryGuildId: string
  ): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Pink);

    const errorContent = [
      `## Wrong server!`,
      `\nThis command can only be used in the **primary server** where modmail threads are created.`,
      `\n\n**Current Primary server**`,
      `\n${primaryGuildName}`,
      `\nID: \`${primaryGuildId}\``,
      `\n\nIf you want this server to be primary, please notify the bot owner to change the primary server ID.`,
    ];

    const text = new TextDisplayBuilder().setContent(errorContent.join(""));

    container.addTextDisplayComponents(text);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  static prefixDeprecationWarning(
    discordClientId: string,
    ownerUserId?: string
  ): MessageCreateOptions {
    const container = new ContainerBuilder();

    const content = [
      `## Text-prefix commands are deprecated`,
      `\nDiscord is revoking **Message Content** access for text-prefix commands. Mention <@${discordClientId}> instead, e.g. \`@bot reply ...\`.`,
      `\n-# Mentioning the bot is the best trade-off for now over migrating everything to slash commands. That becomes a hard requirement once this bot can see 10,000+ users`,
    ];

    if (ownerUserId) {
      content.push(
        ` — until then, DM <@${ownerUserId}> with any suggestions or feedback.`
      );
    } else {
      content.push(`.`);
    }

    const text = new TextDisplayBuilder().setContent(content.join(""));

    container.addTextDisplayComponents(text);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
}
