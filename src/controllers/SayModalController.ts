import type { ModalSubmitInteraction } from "discord.js";
import { getLogger } from "utils/logger";
import type { SayService } from "services/SayService";

export class SayModalController {
  private sayService: SayService;

  private logger = getLogger(this.constructor.name);

  constructor(sayService: SayService) {
    this.sayService = sayService;
  }

  /**
   * Handle say modal submissions.
   */
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
      `Received say modal interaction`
    );

    await this.sayService.handleModalSubmit(interaction);
  }
}
