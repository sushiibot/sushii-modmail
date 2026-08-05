import type {
  GuildTextBasedChannel,
  Message,
  ModalMessageModalSubmitInteraction,
} from "discord.js";
import { getLogger } from "utils/logger";
import {
  parseComposeModalCustomId,
  SayCommandView,
  sayCustomID,
} from "views/Say";

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/;

function parseHexColor(input: string): number | null {
  const match = HEX_COLOR_RE.exec(input.trim());
  if (!match) {
    return null;
  }

  return parseInt(match[1], 16);
}

export class SayService {
  private logger = getLogger(this.constructor.name);

  async promptCompose(
    msg: Message<true>,
    targetChannel: GuildTextBasedChannel
  ): Promise<void> {
    const promptMsg = await msg.reply(
      SayCommandView.promptMessage(targetChannel.id)
    );

    const collector = promptMsg.createMessageComponentCollector({
      time: 5 * 60 * 1000,
    });

    let opened = false;

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== msg.author.id) {
        await interaction.reply({
          content: "Only the person who invoked this command can use it.",
          ephemeral: true,
        });
        return;
      }

      if (!interaction.isButton()) {
        return;
      }

      opened = true;
      collector.stop("opened");

      await interaction.showModal(
        SayCommandView.composeModal(targetChannel.id)
      );
    });

    collector.on("end", async () => {
      if (opened) {
        return;
      }

      try {
        await promptMsg.edit(SayCommandView.expiredPrompt());
      } catch (err) {
        this.logger.error(err, "Failed to edit expired say prompt");
      }
    });
  }

  async handleModalSubmit(
    interaction: ModalMessageModalSubmitInteraction<"cached">
  ): Promise<void> {
    const channelId = parseComposeModalCustomId(interaction.customId);
    if (channelId === null) {
      return;
    }

    const rawColor = interaction.fields.getTextInputValue(
      sayCustomID.fieldColor
    );
    const title = interaction.fields.getTextInputValue(sayCustomID.fieldTitle);
    const body = interaction.fields.getTextInputValue(sayCustomID.fieldBody);

    let color: number | undefined;
    if (rawColor.trim() !== "") {
      const parsed = parseHexColor(rawColor);
      if (parsed === null) {
        await interaction.reply({
          ...SayCommandView.invalidColor(rawColor),
          ephemeral: true,
        });
        return;
      }

      color = parsed;
    }

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content:
          "The target channel no longer exists or isn't a text channel.",
        ephemeral: true,
      });
      return;
    }

    try {
      await channel.send(SayCommandView.resultEmbed(title, body, color));
    } catch (err) {
      this.logger.error(err, "Failed to send say message");
      await interaction.reply({
        content:
          "Failed to send the message. Check my permissions in that channel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.update({
      content: `Message sent to <#${channelId}>.`,
      components: [],
    });
  }
}
