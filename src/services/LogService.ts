import { Client, Colors, EmbedBuilder } from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";

export interface LogConfig {
  logsChannelId: string;
}

export interface LogService {
  logError(error: Error | any, context: string, source: string): Promise<void>;
}

export class DiscordLogService implements LogService {
  private config: LogConfig;
  private client: Client;
  private logger: Logger;

  constructor(config: LogConfig, client: Client) {
    this.config = config;
    this.client = client;
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

    // Skip Discord logging if no logs channel is configured
    if (!this.config.logsChannelId) {
      this.logger.warn(
        "No logs channel configured, skipping Discord error log"
      );
      return;
    }

    try {
      const channel = await this.client.channels.fetch(
        this.config.logsChannelId
      );

      if (!channel || !channel.isSendable()) {
        this.logger.warn(`Invalid logs channel: ${this.config.logsChannelId}`);

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
