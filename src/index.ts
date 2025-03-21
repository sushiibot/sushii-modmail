import { Client, GatewayIntentBits } from "discord.js";
import { getConfigFromEnv, type ConfigType } from "./config/config";
import logger from "./utils/logger";
import CommandRouter from "./CommandRouter";
import dotenv from "dotenv";
import { registerEventHandlers } from "./events";
import { getDb } from "database/db";

// Load environment variables from .env file, mostly for development
dotenv.config();

async function main() {
  const config = getConfigFromEnv();

  // Update log level from config
  logger.info(`Setting log level to ${config.LOG_LEVEL}`);
  logger.level = config.LOG_LEVEL;

  const db = getDb(config.DATABASE_URI);

  const client = new Client({
    intents:
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMembers |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.DirectMessages,
  });

  // Event handlers
  registerEventHandlers(client, db);

  logger.info("Starting Discord client...");

  // Start client, connect to Discord gateway and listen for events
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  logger.error(error, "An error occurred starting the bot");
});
