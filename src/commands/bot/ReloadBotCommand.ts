import type { Message } from "discord.js";
import TextCommandHandler from "../CommandHandler";
import { getLogger } from "utils/logger";
import type { BotManager } from "services/BotManager";
import type { BotRepository } from "repositories/bot.repository";
import { BotAdminView } from "views/BotAdmin";

export class ReloadBotCommand extends TextCommandHandler {
  commandName = "bot";
  subCommandName = "reload";
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

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const name = args[0];
    if (!name) {
      await msg.channel.send(BotAdminView.usage("reload", "<name>"));
      return;
    }

    const entry = await this.botRepository.findByName(name);
    if (!entry) {
      await msg.channel.send(BotAdminView.notFound(name));
      return;
    }

    try {
      const result = await this.botManager.reloadBot(
        entry.applicationId,
        msg.author.id
      );

      const reply = BotAdminView.result(
        !!result.client,
        result.client
          ? `## Reloaded **${entry.name}**`
          : `## Reload of **${entry.name}** failed\n${result.lastError ?? "unknown error"}`
      );

      // A self-targeted reload (@thisBot bot reload thisBot) destroys the
      // very client answering this message -- the send below can throw
      // even though the reload itself succeeded. Caught and logged, not
      // rethrown: there's nothing more to do about it, same accepted
      // limitation as BotAdminModalController's equivalent modal path.
      await msg.channel.send(reply).catch((sendErr) => {
        this.logger.warn(sendErr, "Failed to send reload result");
      });
    } catch (err) {
      this.logger.error(err, "Failed to reload bot");
      const message = err instanceof Error ? err.message : String(err);
      await msg.channel
        .send(
          BotAdminView.result(
            false,
            `## Failed to reload **${entry.name}**\n${message}`
          )
        )
        .catch((sendErr) => {
          this.logger.warn(sendErr, "Failed to send reload error");
        });
    }
  }
}
