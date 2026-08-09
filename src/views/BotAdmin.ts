import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import type { BotSummary } from "services/BotManager";

const prefix = "botadmin.";
const id = (name: string) => `${prefix}${name}`;

export const botAdminCustomID = {
  addButton: id("add.button"),
  addModal: id("add.modal"),
  addName: id("add.name"),
  addToken: id("add.token"),
  addGuildId: id("add.guildId"),

  rotateButtonPrefix: id("rotate.button."),
  rotateModalPrefix: id("rotate.modal."),
  rotateToken: id("rotate.token"),
};

export class BotAdminView {
  static addPrompt(disabled: boolean = false): MessageCreateOptions {
    const button = new ButtonBuilder()
      .setCustomId(botAdminCustomID.addButton)
      .setLabel("Add Bot")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    return {
      content:
        "Click below to add a new bot instance. The token is entered in a modal, never as a command argument.",
      components: [row],
    };
  }

  static addModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(botAdminCustomID.addModal)
      .setTitle("Add Bot");

    const name = new TextInputBuilder()
      .setCustomId(botAdminCustomID.addName)
      .setLabel("Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const token = new TextInputBuilder()
      .setCustomId(botAdminCustomID.addToken)
      .setLabel("Discord Bot Token")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const guildId = new TextInputBuilder()
      .setCustomId(botAdminCustomID.addGuildId)
      .setLabel("Mail Guild ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(name),
      new ActionRowBuilder<TextInputBuilder>().addComponents(token),
      new ActionRowBuilder<TextInputBuilder>().addComponents(guildId)
    );

    return modal;
  }

  static rotatePrompt(
    name: string,
    applicationId: string,
    disabled: boolean = false
  ): MessageCreateOptions {
    const button = new ButtonBuilder()
      .setCustomId(`${botAdminCustomID.rotateButtonPrefix}${applicationId}`)
      .setLabel(`Rotate token for "${name}"`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    return {
      content: `Click below to rotate the token for **${name}**.`,
      components: [row],
    };
  }

  static rotateModal(name: string, applicationId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`${botAdminCustomID.rotateModalPrefix}${applicationId}`)
      .setTitle(`Rotate token: ${name}`.slice(0, 45));

    const token = new TextInputBuilder()
      .setCustomId(botAdminCustomID.rotateToken)
      .setLabel("New Discord Bot Token")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(token)
    );

    return modal;
  }

  static list(summaries: BotSummary[]): MessageCreateOptions {
    if (summaries.length === 0) {
      return { content: "No bots configured." };
    }

    const lines = summaries.map((s) => {
      const ping = s.ping !== null ? `${s.ping}ms` : "n/a";
      let line = `**${s.name}** \`${s.applicationId}\` -- guild \`${s.mailGuildId}\` -- ${s.status} (ping: ${ping})`;
      if (s.lastError) {
        line += `\n> last error: ${s.lastError}`;
      }
      return line;
    });

    return { content: lines.join("\n") };
  }
}
