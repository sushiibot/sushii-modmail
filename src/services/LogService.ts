import { Client, Colors, EmbedBuilder } from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";
import type { RuntimeConfig } from "models/runtimeConfig.model";

export interface LogService {
  logError(error: Error | any, context: string, source: string): Promise<void>;
}

interface ConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
}

export class DiscordLogService implements LogService {
  private client: Client;
  private configRepository: ConfigRepository;
  private guildId: string;

  private logger: Logger;

  constructor(
    client: Client,
    configRepository: ConfigRepository,
    guildId: string
  ) {
    this.client = client;
    this.configRepository = configRepository;
    this.guildId = guildId;

    this.logger = getLogger("LogService");
  }

  /**
   * Logs an error to both the console and the logs channel if configured
   * @param error The error to log
   * @param context Additional context about the error
   * @param source The source of the error (e.g. class name)
   */
  async logError(
    error: Error | any,
    context: string,
    source: string
  ): Promise<void> {
    // Always log to console first
    this.logger.error(error, `[${source}] ${context}`);

    const config = await this.configRepository.getConfig(this.guildId);
    if (!config.logsChannelId) {
      this.logger.warn(
        "No logs channel configured, skipping Discord error log"
      );
      return;
    }

    try {
      const channel = await this.client.channels.fetch(config.logsChannelId);

      if (!channel || !channel.isSendable()) {
        this.logger.warn(`Invalid logs channel: ${config.logsChannelId}`);

        return;
      }

      const errorEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`Error in ${source}`)
        .setDescription(context)
        .addFields(
          {
            name: "Error Message",
            value:
              error.message ||
              String(error).substring(0, 1024) ||
              "Unknown error",
          },
          {
            name: "Stack Trace",
            value: (error.stack || "No stack trace").substring(0, 1024),
          }
        )
        .setTimestamp();

      await channel.send({ embeds: [errorEmbed] });
    } catch (err) {
      // Just log to console if sending to Discord fails - avoid infinite loops
      this.logger.error(err, `Failed to send error log to Discord channel`);
    }
  }
}
