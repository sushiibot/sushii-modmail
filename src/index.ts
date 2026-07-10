import { setupOtel } from "./instrumentation";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { getConfigFromEnv } from "./config/config";
import { EnvBotRegistry, type BotRosterEntry } from "./config/botRegistry";
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
import { BotConfig, type GlobalConfig } from "models/botConfig.model";
import { CloseCommand } from "commands/CloseCommand";
import { LogsCommand } from "commands/LogsCommand";
import { PlainReplyCommand } from "commands/reply/PlainReplyCommand";
import { AddSnippetCommand } from "commands/snippets/AddSnippetCommand";
import { GetSnippetCommand } from "commands/snippets/GetSnippetCommand";
import { SnippetService } from "services/SnippetService";
import { SnippetRepository } from "repositories/snippet.repository";
import { EditSnippetCommand } from "commands/snippets/EditSnippetCommand";
import { DeleteSnippetCommand } from "commands/snippets/DeleteSnippetCommand";
import { ListSnippetsCommand } from "commands/snippets/ListSnippetsCommand";
import { ContactCommand } from "commands/ContactCommand";
import { RuntimeConfigRepository } from "repositories/runtimeConfig.repository";
import { MessageRepository } from "repositories/message.repository";
import { EditCommand } from "commands/EditCommand";
import { DeleteCommand } from "commands/DeleteCommand";
import { SettingsCommand } from "commands/SettingsCommand";
import { BotEmojiRepository } from "repositories/botEmoji.repository";
import { SettingsService } from "services/SettingsService";
import { HelpCommand } from "commands/HelpCommand";
import { AnonymousPlainReplyCommand } from "commands/reply/AnonymousPlainReplyCommand";
import { HealthcheckService, type BotInstance } from "services/HealthcheckService";
import * as Sentry from "@sentry/bun";

// Load environment variables from .env file, mostly for development
dotenv.config();

function buildCommandRouter(
  config: BotConfig,
  client: Client,
  db: DB
): CommandRouter {
  const threadRepository = new ThreadRepository(db);
  const snippetRepository = new SnippetRepository(db);
  const runtimeConfigRepository = new RuntimeConfigRepository(
    db,
    config.discordClientId
  );
  const messageRepository = new MessageRepository(db);
  const botEmojiRepository = new BotEmojiRepository(db, config.discordClientId);

  const threadService = new ThreadService(
    config,
    client,
    runtimeConfigRepository,
    threadRepository,
    botEmojiRepository
  );
  const messageService = new MessageRelayService(
    config,
    client,
    runtimeConfigRepository,
    threadRepository,
    messageRepository,
    botEmojiRepository
  );
  const snippetService = new SnippetService(config, client, snippetRepository);

  // Commands
  const router = new CommandRouter(runtimeConfigRepository, config);

  // Settings service
  const settingsService = new SettingsService(
    runtimeConfigRepository,
    botEmojiRepository
  );

  router.addCommands(
    // Reply commands
    new ReplyCommand(threadService, messageService, runtimeConfigRepository),
    new AnonymousReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),
    new AnonymousPlainReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),
    new PlainReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),

    // Thread message commands
    new EditCommand(threadService, messageService, runtimeConfigRepository),
    new DeleteCommand(threadService, messageService),

    // Snippets
    new GetSnippetCommand(snippetService),
    new AddSnippetCommand(snippetService),
    new EditSnippetCommand(snippetService),
    new DeleteSnippetCommand(snippetService),
    new ListSnippetsCommand(snippetService),

    // Other
    new CloseCommand(threadService, runtimeConfigRepository),
    new LogsCommand(threadService, messageService, runtimeConfigRepository),
    new ContactCommand(threadService, messageService),

    // Settings
    new SettingsCommand(settingsService),
    new HelpCommand(config)
  );

  snippetService.setReservedNames(router.getCommandNames());

  return router;
}

interface StartedBot {
  config: BotConfig;
  client: Client;
}

/**
 * Builds the client, command router, and event handlers for one roster
 * entry -- everything up to (but not including) the Discord login. Kept
 * separate from the login step so the healthcheck server can start, and
 * report every bot's status, before any login has settled (see
 * startBot's login step below).
 */
function createBot(
  entry: BotRosterEntry,
  globals: GlobalConfig,
  db: DB
): StartedBot {
  const config = BotConfig.fromRosterEntry(entry, globals);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
    ],
    // Partials.Channel: Required to receive DMs with Events.MessageCreate
    // Partials.Reaction and Partials.Message: Required to receive reactions on uncached messages
    partials: [
      Partials.Channel,
      Partials.Reaction,
      Partials.Message,
      Partials.GuildMember,
      // For reactions on non-cached messages
      Partials.Reaction,
      Partials.User,
    ],
  });

  logger.info({ bot: config.name }, "Initializing command router...");
  const router = buildCommandRouter(config, client, db);

  logger.info({ bot: config.name }, "Registering event handlers...");
  registerEventHandlers(config, client, db, router);

  return { config, client };
}

async function loginBot(bot: StartedBot): Promise<void> {
  logger.info({ bot: bot.config.name }, "Starting Discord client...");
  await bot.client.login(bot.config.discordToken);
}

async function main() {
  const otel = setupOtel();

  Sentry.init({
    // DSN read from SENTRY_DSN env var
    // Environment read from SENTRY_ENVIRONMENT env var
    release: process.env.GIT_HASH,
    tracesSampleRate: 0,
  });

  // unhandledRejection/uncaughtException didn't exist before this change,
  // since a crash previously just took down one single-bot container. Now
  // an error in one bot's event handler must not kill the others sharing
  // this process -- log and continue rather than process.exit().
  //
  // This is a deliberate, incomplete mitigation (see design.md Risks): it
  // covers the common case of an unhandled rejection/exception deep in a
  // discord.js event callback, but a genuinely corrupted process state
  // (e.g. a synchronous stack overflow) can still leave things in a bad
  // spot after an uncaughtException specifically -- Node's own guidance
  // is to treat that handler as a last-resort log-and-exit, not a resume
  // point. The log-and-continue choice here trades that residual risk for
  // not taking every other bot down over one bad event handler; revisit
  // if it proves insufficient in production.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
  });

  const globals = getConfigFromEnv();

  // Update log level from config
  logger.info(`Setting log level to ${globals.LOG_LEVEL}`);
  initLogger(globals.LOG_LEVEL);

  const db = getDb(globals.DATABASE_URI);

  const registry = new EnvBotRegistry();
  const roster = await registry.getBotConfigs();

  // Construct every bot's client/router/handlers (fast, no network I/O)
  // before starting the healthcheck server or attempting any login. A bad
  // roster entry (rare -- this is DI wiring, not I/O) is isolated the
  // same way a failed login is below, not allowed to take down the batch.
  const bots: StartedBot[] = [];
  for (const entry of roster) {
    try {
      bots.push(createBot(entry, globals, db));
    } catch (err) {
      logger.error(
        { err, bot: entry.name },
        `Failed to initialize bot "${entry.name}"`
      );
    }
  }

  if (bots.length === 0) {
    throw new Error("All bots failed to initialize");
  }

  // Start the healthcheck server before any login attempt completes, with
  // every constructed client (including ones whose login later fails or
  // hangs) -- /live must not depend on login completing, and a failed
  // login must show as unhealthy rather than silently disappearing from
  // /ready. getSummary() reads client.isReady()/ws.status live, so this
  // reflects each bot's real-time status regardless of when/whether its
  // login settles.
  const healthInstances: BotInstance[] = bots.map((b) => ({
    name: b.config.name,
    client: b.client,
  }));
  const healthcheckService = new HealthcheckService(
    healthInstances,
    globals.HEALTHCHECK_PORT
  );
  healthcheckService.start();

  const loginResults = await Promise.allSettled(bots.map(loginBot));

  let loggedInCount = 0;
  for (const [i, result] of loginResults.entries()) {
    if (result.status === "fulfilled") {
      loggedInCount += 1;
    } else {
      logger.error(
        { err: result.reason, bot: bots[i].config.name },
        `Failed to log in bot "${bots[i].config.name}"`
      );
    }
  }

  if (loggedInCount === 0) {
    healthcheckService.stop();
    throw new Error("All bots failed to log in");
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    healthcheckService.stop();
    await otel.shutdown();
    for (const b of bots) {
      b.client.destroy();
    }
    process.exit(0);
  };

  const handleSignal = (signal: string) =>
    shutdown(signal).catch((err) => {
      logger.error(err, "Error during shutdown");
      process.exit(1);
    });

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

main().catch((error) => {
  logger.error(error, "An error occurred starting the bot");
});
