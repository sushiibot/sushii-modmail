import type { Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import { getLogger } from "utils/logger";
import type { BotManager } from "services/BotManager";
import type { BotRepository } from "repositories/bot.repository";

export class RemoveBotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = "remove";
  aliases: string[] = [];
  requiresPrimaryServer = false;
  ownerOnly = true;

  private logger = getLogger(this.constructor.name);
  private botManager: BotManager;
  private botRepository: BotRepository;

  constructor(botManager: BotManager, botRepository: BotRepository) {
    super();
    this.botManager = botManager;
    this.botRepository = botRepository;
  }

  // No confirmation step, consistent with this repo's existing
  // snippet-delete having none either.
  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const name = args[0];
    if (!name) {
      await msg.channel.send("Usage: `bot remove <name>`");
      return;
    }

    const entry = await this.botRepository.findByName(name);
    if (!entry) {
      await msg.channel.send(`No bot named \`${name}\`.`);
      return;
    }

    try {
      await this.botManager.removeBot(entry.applicationId, msg.author.id);

      // A self-targeted remove (@thisBot bot remove thisBot) destroys the
      // very client answering this message before this send runs -- the
      // removal itself has already succeeded regardless of whether this
      // confirmation lands, so a send failure here is caught and logged,
      // not rethrown.
      await msg.channel.send(`Removed **${entry.name}**.`).catch((sendErr) => {
        this.logger.warn(sendErr, "Failed to send remove confirmation");
      });
    } catch (err) {
      this.logger.error(err, "Failed to remove bot");
      const message = err instanceof Error ? err.message : String(err);
      await msg.channel
        .send(`Failed to remove **${entry.name}**: ${message}`)
        .catch((sendErr) => {
          this.logger.warn(sendErr, "Failed to send remove error");
        });
    }
  }
}
