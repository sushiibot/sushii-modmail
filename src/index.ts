import { setupOtel } from "./instrumentation";
import { getConfigFromEnv } from "./config/config";
import logger, { initLogger } from "./utils/logger";
import dotenv from "dotenv";
import { getDb } from "database/db";
import { BotRepository } from "repositories/bot.repository";
import { BotManager } from "services/BotManager";
import { seedIfNeeded } from "services/botSeed";
import { HealthcheckService } from "services/HealthcheckService";
import { initMetrics, registerBotGatewayMetrics } from "utils/metrics";
import * as Sentry from "@sentry/bun";

// Load environment variables from .env file, mostly for development
dotenv.config();

async function main() {
  const otel = setupOtel();
  initMetrics();

  Sentry.init({
    // DSN read from SENTRY_DSN env var
    // Environment read from SENTRY_ENVIRONMENT env var
    release: process.env.GIT_HASH,
    tracesSampleRate: 0,
    // setupOtel() above already registered our own tracer/context
    // providers -- without this, Sentry's own OTel auto-setup tries to
    // register a second time and silently loses (ours ran first),
    // logging "Attempted duplicate registration of API" on every startup.
    skipOpenTelemetrySetup: true,
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

  if (!globals.OWNER_USER_ID) {
    logger.warn(
      "OWNER_USER_ID is not set -- `bot` admin commands are registered but unreachable."
    );
  }

  // Update log level from config
  logger.info(`Setting log level to ${globals.LOG_LEVEL}`);
  initLogger(globals.LOG_LEVEL);

  const db = getDb(globals.DATABASE_URI);
  const botRepository = new BotRepository(db);

  await seedIfNeeded(db, botRepository);

  const botManager = new BotManager(db, globals, botRepository);

  // Healthcheck/metrics start reading BotManager's summaries before any
  // login is attempted -- /live doesn't depend on login completing, and a
  // failed login shows up as unhealthy instead of silently disappearing.
  const healthcheckService = new HealthcheckService(
    botManager,
    globals.HEALTHCHECK_PORT
  );
  healthcheckService.start();

  registerBotGatewayMetrics(() => botManager.getSummaries());

  const roster = await botRepository.list();
  await botManager.startAllForBoot(roster);

  // A bot counts as logged in once startInternal's client.login() call
  // resolves without throwing -- that's the same signal the old
  // Promise.allSettled(bots.map(loginBot)) loop used. It's deliberately
  // NOT status === "connected": login() resolving only means the token
  // was accepted and IDENTIFY was sent, not that the READY gateway event
  // (which flips ws.status to Ready, sometimes tens to hundreds of ms
  // later) has already arrived by the time this line runs. Gating on
  // "connected" here made every deploy spuriously read as "zero bots
  // logged in" and throw before READY had a chance to land.
  const loggedInCount = botManager
    .getSummaries()
    .filter((s) => s.status !== "failed").length;

  if (loggedInCount === 0) {
    healthcheckService.stop();
    throw new Error(
      "All bots failed to log in. If the `bots` table can't produce a " +
        "single connected bot, restore working env vars and delete the " +
        "bot_roster_seed_state row to force a re-seed from env on the " +
        "next start."
    );
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    healthcheckService.stop();
    await otel.shutdown();
    await botManager.destroyAll();
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
