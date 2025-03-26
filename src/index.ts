import { Client, GatewayIntentBits, Partials } from "discord.js";
import { getConfigFromEnv, type ConfigType } from "./config/config";
import logger, { initLogger } from "./utils/logger";
import CommandRouter from "./CommandRouter";
import dotenv from "dotenv";
import { registerEventHandlers } from "./events";
import { getDb, type DB } from "database/db";
import { ReplyCommand } from "commands/reply/ReplyCommand";
import { MessageRelayService } from "services/MessageRelayService";
import { ThreadService } from "services/ThreadService";
import { ThreadRepository } from "repositories/thread.repository";
import { AnonymousReplyCommand } from "commands/reply/AnonymousReplyCommand";
import { BotConfig } from "models/botConfig.model";
import { CloseCommand } from "commands/CloseCommand";
import { LogsCommand } from "commands/LogsCommand";
import { PlainReplyCommand } from "commands/reply/PlainReplyCommand";
import { AddSnippetCommand } from "commands/snippets/AddSnippetCommand";
import { SnippetService } from "services/SnippetService";
import { SnippetRepository } from "repositories/snippet.repository";
import { EditSnippetCommand } from "commands/snippets/EditSnippetCommand";
import { DeleteSnippetCommand } from "commands/snippets/DeleteSnippetCommand";
import { ListSnippetsCommand } from "commands/snippets/ListSnippetsCommand";
import { ContactCommand } from "commands/ContactCommand";
import { RuntimeConfigRepository } from "repositories/runtimeConfig.repository";

// Load environment variables from .env file, mostly for development
dotenv.config();

function buildCommandRouter(
  config: BotConfig,
  client: Client,
  db: DB
): CommandRouter {
  const threadRepository = new ThreadRepository(db);
  const snippetRepository = new SnippetRepository(db);
  const runtimeConfigRepository = new RuntimeConfigRepository(db);

  const threadService = new ThreadService(
    config,
    client,
    threadRepository,
    runtimeConfigRepository
  );
  const messageService = new MessageRelayService(config, client);
  const snippetService = new SnippetService(config, client, snippetRepository);

  // Commands
  const router = new CommandRouter(config);

  router.addCommands(
    // Reply commands
    new ReplyCommand(config.forumChannelId, threadService, messageService),
    new AnonymousReplyCommand(
      config.forumChannelId,
      threadService,
      messageService
    ),
    new PlainReplyCommand(config.forumChannelId, threadService, messageService),

    // Snippets
    new AddSnippetCommand(snippetService),
    new EditSnippetCommand(snippetService),
    new DeleteSnippetCommand(snippetService),
    new ListSnippetsCommand(snippetService),

    // Other
    new LogsCommand(config.forumChannelId, threadService, messageService),
    new CloseCommand(config.forumChannelId, threadService),
    new ContactCommand(threadService, messageService)
  );

  return router;
}

async function main() {
  const rawConfig = getConfigFromEnv();
  const config = BotConfig.fromConfigType(rawConfig);

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
