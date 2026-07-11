import { Hono } from "hono";
import { serve } from "bun";
import { Status, type Client } from "discord.js";
import logger from "../utils/logger";

export enum HealthStatus {
  INITIALIZING = "initializing",
  READY = "ready",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

export interface BotInstance {
  name: string;
  client: Client;
}

export class HealthcheckService {
  private app: Hono;
  private server: any;
  private bots: BotInstance[];
  private port: number;

  constructor(bots: BotInstance[], port: number = 3000) {
    this.bots = bots;
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

  private getSummary() {
    const bots = this.bots.map((bot) => {
      const status = this.getDiscordStatus(bot.client);

      return {
        name: bot.name,
        status,
        ready: status === HealthStatus.READY,
        discord: {
          ready: bot.client.isReady(),
          uptime: bot.client.uptime,
          ping: bot.client.ws.ping,
        },
      };
    });

    const allReady = bots.every((b) => b.ready);

    return {
      bots,
      allReady,
      overallStatus: allReady ? HealthStatus.READY : HealthStatus.DISCONNECTED,
    };
  }

  private getDiscordStatus(client: Client): HealthStatus {
    if (!client.isReady()) {
      // Check if we're still connecting or have failed
      switch (client.ws.status) {
        case Status.Ready: {
          return HealthStatus.READY;
        }
        case Status.Connecting: {
          return HealthStatus.INITIALIZING;
        }
        case Status.Disconnected: {
          return HealthStatus.DISCONNECTED;
        }
        default: {
          return HealthStatus.ERROR;
        }
      }
    }

    return HealthStatus.READY;
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
