import type { ModalSubmitInteraction } from "discord.js";
import { getLogger } from "utils/logger";
import type { ToolbarController } from "controllers/ToolbarController";

export class ToolbarModalController {
  private toolbarController: ToolbarController;

  private logger = getLogger(this.constructor.name);

  constructor(toolbarController: ToolbarController) {
    this.toolbarController = toolbarController;
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      return;
    }

    if (!interaction.isFromMessage()) {
      return;
    }

    this.logger.debug(
      {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        customId: interaction.customId,
      },
      "Received toolbar modal interaction"
    );

    await this.toolbarController.handleModalSubmit(interaction);
  }
}
