import { Client, GatewayIntentBits } from "discord.js";
import { getConfigFromEnv, type ConfigType } from "./config/config";
import logger from "./utils/logger";
import CommandRouter from "./CommandRouter";
import dotenv from "dotenv";
import { registerEventHandlers } from "./events";
import { getDb, type DB } from "database/db";
import { ReplyCommand } from "commands/ReplyCommand";
import { MessageRelayService } from "services/MessageRelayService";
import { ThreadService } from "services/threadService";
import { ThreadRepository } from "repositories/thread.repository";
import { AnonymousReplyCommand } from "commands/AnonymousReplyCommand";

// Load environment variables from .env file, mostly for development
dotenv.config();

function buildCommandRouter(db: DB): CommandRouter {
  const threadRepository = new ThreadRepository(db);
  const threadService = new ThreadService(threadRepository);
  const messageService = new MessageRelayService();

  // Commands
  const replyCommand = new ReplyCommand(threadService, messageService);
  const areplyCommand = new AnonymousReplyCommand(
    threadService,
    messageService
  );

  const router = new CommandRouter();
  router.addCommands(replyCommand, areplyCommand);

  return router;
}

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

  const router = buildCommandRouter(db);

  // Event handlers
  registerEventHandlers(client, db, router);

  logger.info("Starting Discord client...");

  // Start client, connect to Discord gateway and listen for events
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  logger.error(error, "An error occurred starting the bot");
});
