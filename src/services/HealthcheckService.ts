import { Hono } from "hono";
import { serve } from "bun";
import logger from "../utils/logger";
import { BOT_STATUS_CODES, type BotSummary } from "./BotManager";

export enum HealthStatus {
  INITIALIZING = "initializing",
  READY = "ready",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

export interface SummaryProvider {
  getSummaries(): BotSummary[];
}

export class HealthcheckService {
  private app: Hono;
  private server: any;
  private provider: SummaryProvider;
  private port: number;

  constructor(provider: SummaryProvider, port: number = 3000) {
    this.provider = provider;
    this.port = port;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Process-up liveness -- must NOT depend on any individual bot's
    // Discord connection state, so a single bot's transient disconnect
    // doesn't trigger an orchestrator restart that kills every other
    // healthy bot.
    this.app.get("/live", (c) => {
      return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
      });
    });

    this.app.get("/health", (c) => {
      const summary = this.getSummary();

      return c.json(
        {
          status: summary.overallStatus,
          timestamp: new Date().toISOString(),
          version: {
            gitHash: process.env.GIT_HASH || "unknown",
            buildDate: process.env.BUILD_DATE || "unknown",
          },
          bots: summary.bots,
        },
        summary.allReady ? 200 : 503
      );
    });

    this.app.get("/ready", (c) => {
      const summary = this.getSummary();

      return c.json(
        {
          ready: summary.allReady,
          status: summary.overallStatus,
          timestamp: new Date().toISOString(),
          bots: summary.bots,
        },
        summary.allReady ? 200 : 503
      );
    });
  }

  // No Client is ever touched here -- BotManager already computed
  // status/ping into a plain-data BotSummary, so there's nothing to
  // null-check even for a `failed` (client-less) bot.
  private getSummary() {
    const summaries = this.provider.getSummaries();

    const bots = summaries.map((bot) => ({
      name: bot.name,
      status: this.toHealthStatus(bot.status),
      ready: bot.status === "connected",
      discord: {
        ping: bot.ping,
      },
      lastError: bot.lastError,
    }));

    // A `failed` bot counts against readiness (it's a real problem worth
    // surfacing), but each bot's status is still reported individually so
    // it's diagnosable at a glance rather than just a blanket 503. Zero
    // summaries (e.g. before BotManager has registered anything) must not
    // read as vacuously ready.
    const allReady = bots.length > 0 && bots.every((b) => b.ready);

    return {
      bots,
      allReady,
      overallStatus: allReady ? HealthStatus.READY : HealthStatus.DISCONNECTED,
    };
  }

  // Looks up the single shared BOT_STATUS_CODES table (BotManager.ts)
  // instead of maintaining a parallel switch here -- HealthStatus's
  // member values are exactly those health labels, so this is a lookup,
  // not a re-derivation.
  private toHealthStatus(status: BotSummary["status"]): HealthStatus {
    return BOT_STATUS_CODES[status].health as HealthStatus;
  }

  public start() {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
    });

    logger.info(`Healthcheck server started on port ${this.port}`);
  }

  public stop() {
    if (this.server) {
      this.server.stop();
      logger.info("Healthcheck server stopped");
    }
  }
}
