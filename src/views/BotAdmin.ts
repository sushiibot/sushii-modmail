import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import { HexColor } from "./Color";
import type { BotSummary } from "services/BotManager";

const statusEmoji: Record<BotSummary["status"], string> = {
  connected: "🟢",
  connecting: "🟡",
  disconnected: "⚪",
  failed: "🔴",
};

function componentsV2(container: ContainerBuilder): MessageCreateOptions {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

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

    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Add a bot\nClick below to register a new bot instance."
      )
    );
    container.addActionRowComponents(row);

    return componentsV2(container);
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

    const container = new ContainerBuilder().setAccentColor(HexColor.Purple);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Rotate token\nClick below to rotate the token for **${name}**.`
      )
    );
    container.addActionRowComponents(row);

    return componentsV2(container);
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
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    if (summaries.length === 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "## Bots\nNo bots configured. Use `bot add` to register one."
        )
      );
      return componentsV2(container);
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Bots (${summaries.length})`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder());

    summaries.forEach((s, i) => {
      const ping = s.ping !== null ? `${s.ping}ms` : "n/a";
      const lines = [
        `${statusEmoji[s.status]} **${s.name}** -- \`${s.status}\` (ping: ${ping})`,
        `Application ID: \`${s.applicationId}\``,
        `Guild ID: \`${s.mailGuildId}\``,
      ];
      if (s.lastError) {
        lines.push(`> Last error: ${s.lastError}`);
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n"))
      );

      if (i < summaries.length - 1) {
        container.addSeparatorComponents(new SeparatorBuilder());
      }
    });

    return componentsV2(container);
  }

  static help(): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    const content = [
      "## Bot admin commands",
      "\n`bot list` -- Show all registered bots and their status",
      "\n`bot add` -- Register a new bot instance (opens a modal for the token)",
      "\n`bot reload <name>` -- Reconnect a bot using its stored token",
      "\n`bot remove <name>` -- Remove a bot instance",
      "\n`bot rotate <name>` -- Replace a bot's stored token (opens a modal)",
      "\n\n`<name>` is the bot's registered name shown in **bold** by `bot list`.",
    ];

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content.join(""))
    );

    return componentsV2(container);
  }

  static usage(subCommand: string, argsHint: string): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Pink);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Missing argument\n\`\`\`\nbot ${subCommand} ${argsHint}\n\`\`\`\n\`<name>\` is the bot's registered name, shown in **bold** by \`bot list\`.`
      )
    );

    return componentsV2(container);
  }

  static notFound(name: string): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Pink);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## No bot named \`${name}\`\nRun \`bot list\` to see registered bot names.`
      )
    );

    return componentsV2(container);
  }

  static result(
    ok: boolean,
    message: string
  ): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(
      ok ? HexColor.Green : HexColor.Pink
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message)
    );

    return componentsV2(container);
  }
}
