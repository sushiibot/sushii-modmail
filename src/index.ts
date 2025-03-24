import { Client, GatewayIntentBits, Partials } from "discord.js";
import { getConfigFromEnv, type ConfigType } from "./config/config";
import logger, { initLogger } from "./utils/logger";
import CommandRouter from "./CommandRouter";
import dotenv from "dotenv";
import { registerEventHandlers } from "./events";
import { getDb, type DB } from "database/db";
import { ReplyCommand } from "commands/ReplyCommand";
import { MessageRelayService } from "services/MessageRelayService";
import { ThreadService } from "services/ThreadService";
import { ThreadRepository } from "repositories/thread.repository";
import { AnonymousReplyCommand } from "commands/AnonymousReplyCommand";
import { ConfigModel } from "models/config.model";

// Load environment variables from .env file, mostly for development
dotenv.config();

function buildCommandRouter(
  config: ConfigModel,
  client: Client,
  db: DB
): CommandRouter {
  const threadRepository = new ThreadRepository(db);

  const threadService = new ThreadService(config, client, threadRepository);
  const messageService = new MessageRelayService(config, client);

  // Commands
  const replyCommand = new ReplyCommand(
    config.forumChannelId,
    threadService,
    messageService
  );
  const areplyCommand = new AnonymousReplyCommand(
    config.forumChannelId,
    threadService,
    messageService
  );

  const router = new CommandRouter(config);
  router.addCommands(replyCommand, areplyCommand);

  return router;
}

async function main() {
  const rawConfig = getConfigFromEnv();
  const config = ConfigModel.fromConfigType(rawConfig);

  // Update log level from config
  logger.info(`Setting log level to ${config.logLevel}`);
  initLogger(config.logLevel);

  const db = getDb(config.databaseUri);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    // Required to receive DMs with Events.MessageCreate
    partials: [Partials.Channel],
  });

  logger.info("Initializing command router...");
  const router = buildCommandRouter(config, client, db);

  // Event handlers
  logger.info("Registering event handlers...");
  registerEventHandlers(config, client, db, router);

  logger.info("Starting Discord client...");

  // Start client, connect to Discord gateway and listen for events
  await client.login(config.discordToken);
}

main().catch((error) => {
  logger.error(error, "An error occurred starting the bot");
});
