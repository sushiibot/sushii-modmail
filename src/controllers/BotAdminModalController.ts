import {
  MessageFlags,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import { getLogger } from "utils/logger";
import type { BotManager } from "services/BotManager";
import { botAdminCustomID, BotAdminView } from "views/BotAdmin";
import { buildInviteLink } from "utils/discordInvite";

export class BotAdminModalController {
  private botManager: BotManager;
  private ownerUserId?: string;

  private logger = getLogger(this.constructor.name);

  constructor(botManager: BotManager, ownerUserId?: string) {
    this.botManager = botManager;
    this.ownerUserId = ownerUserId;
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    // Must run before any deferReply -- every registered modal controller
    // is called unconditionally on every modal submission in events.ts,
    // and they rely on this fast, synchronous no-op to fall through to
    // the next one.
    const isAdd = interaction.customId === botAdminCustomID.addModal;
    const isRotate = interaction.customId.startsWith(
      botAdminCustomID.rotateModalPrefix
    );

    if (!isAdd && !isRotate) {
      return;
    }

    if (!this.ownerUserId || interaction.user.id !== this.ownerUserId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (isAdd) {
        await this.handleAdd(interaction);
      } else {
        await this.handleRotate(interaction);
      }
    } catch (err) {
      this.logger.error(err, "Failed to handle bot admin modal submission");
      const message = err instanceof Error ? err.message : String(err);

      // editReply can itself fail on a self-targeted reload/rotate (the
      // client answering this interaction may be the one just destroyed)
      // -- caught and logged, not thrown, since there's nothing more to
      // do about it.
      await interaction.editReply(`Failed: ${message}`).catch((editErr) => {
        this.logger.warn(editErr, "Failed to edit reply after modal error");
      });
    }
  }

  private async handleAdd(interaction: ModalSubmitInteraction): Promise<void> {
    const name = interaction.fields.getTextInputValue(
      botAdminCustomID.addName
    );
    const token = interaction.fields.getTextInputValue(
      botAdminCustomID.addToken
    );
    const guildId = interaction.fields.getTextInputValue(
      botAdminCustomID.addGuildId
    );

    const result = await this.botManager.addBot(
      name,
      token,
      guildId,
      interaction.user.id
    );

    const inviteLink = buildInviteLink(result.entry.applicationId);

    const summaryLine = result.client
      ? `Added and started **${name}**.`
      : `Added **${name}**, but it failed to start: ${result.lastError ?? "unknown error"}`;

    await interaction
      .editReply(`${summaryLine}\nInvite: ${inviteLink}`)
      .catch((err) => {
        this.logger.warn(err, "Failed to edit reply after add-bot submission");
      });

    // Public follow-up so staff who saw the "Add Bot" prompt also see the
    // result, unlike the ephemeral reply above which only the invoker sees.
    await interaction
      .followUp(
        BotAdminView.list(this.botManager.getSummaries()) as InteractionReplyOptions
      )
      .catch((err) => {
        this.logger.warn(err, "Failed to post bot list after add-bot submission");
      });
  }

  private async handleRotate(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    const applicationId = interaction.customId.slice(
      botAdminCustomID.rotateModalPrefix.length
    );
    const newToken = interaction.fields.getTextInputValue(
      botAdminCustomID.rotateToken
    );

    const result = await this.botManager.rotateToken(
      applicationId,
      newToken,
      interaction.user.id
    );

    if (result.client) {
      await interaction
        .editReply(`Rotated token and reloaded **${result.entry.name}**.`)
        .catch((err) => {
          this.logger.warn(err, "Failed to edit reply after rotate success");
        });
    } else {
      await interaction
        .editReply(
          `Rotated token for **${result.entry.name}**, but reload failed: ${result.lastError ?? "unknown error"}`
        )
        .catch((err) => {
          this.logger.warn(err, "Failed to edit reply after rotate partial failure");
        });
    }
  }
}
