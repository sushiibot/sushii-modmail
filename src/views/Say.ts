import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import { HexColor } from "./Color";

const sayCustomIDPrefix = "cmd.say.";
const modalCustomIDPrefix = "modal.say.";

export const sayCustomID = {
  compose: `${sayCustomIDPrefix}compose`,

  fieldColor: "say.color",
  fieldTitle: "say.title",
  fieldBody: "say.body",
};

export function buildComposeModalCustomId(channelId: string): string {
  return `${modalCustomIDPrefix}${channelId}`;
}

export function parseComposeModalCustomId(customId: string): string | null {
  if (!customId.startsWith(modalCustomIDPrefix)) {
    return null;
  }

  return customId.slice(modalCustomIDPrefix.length);
}

export class SayCommandView {
  static promptMessage(channelId: string): MessageCreateOptions {
    const button = new ButtonBuilder()
      .setCustomId(sayCustomID.compose)
      .setLabel("Compose Message")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    return {
      content: `Click below to compose a message to send in <#${channelId}>.`,
      components: [row],
      allowedMentions: { parse: [] },
    };
  }

  static expiredPrompt() {
    return {
      content: "This `-say` prompt expired. Run the command again.",
      components: [],
      allowedMentions: { parse: [] },
    };
  }

  static composeModal(channelId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(buildComposeModalCustomId(channelId))
      .setTitle("Compose Message");

    const colorInput = new TextInputBuilder()
      .setCustomId(sayCustomID.fieldColor)
      .setLabel("Color (hex, optional)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(7)
      .setPlaceholder("#5865F2");

    const titleInput = new TextInputBuilder()
      .setCustomId(sayCustomID.fieldTitle)
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const bodyInput = new TextInputBuilder()
      .setCustomId(sayCustomID.fieldBody)
      .setLabel("Message")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput)
    );

    return modal;
  }

  static resultEmbed(
    title: string,
    body: string,
    color?: number
  ): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(body)
      .setColor(color ?? HexColor.Blue);

    return { embeds: [embed] };
  }

  static channelNotFound(): MessageCreateOptions {
    return {
      content:
        "Couldn't find that channel. Mention it or use its ID, e.g. `-say #announcements`.",
      allowedMentions: { parse: [] },
    };
  }

  static channelNotSendable(): MessageCreateOptions {
    return {
      content:
        "I don't have permission to view/send messages/embed links in that channel.",
      allowedMentions: { parse: [] },
    };
  }

  static invalidColor(rawColor: string) {
    return {
      content: `\`${rawColor}\` isn't a valid hex color. Use a format like \`#5865F2\`.`,
      allowedMentions: { parse: [] },
    };
  }

  static errorStarting(): MessageCreateOptions {
    return {
      content: "Failed to start the `-say` command. Please check the logs.",
      allowedMentions: { parse: [] },
    };
  }
}
