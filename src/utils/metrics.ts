import { ValueType, metrics } from "@opentelemetry/api";
import type { Client } from "discord.js";

const gatewayMeter = metrics.getMeter("gateway", "1.0");

// Mirrors sushii-bot's shard_status/shard_latency pattern (see
// packages/sushii-worker/.../CoreMetrics.ts), labeled by bot name instead
// of shard id since each modmail bot is its own unsharded Client.
const botStatusGauge = gatewayMeter.createObservableGauge("bot_status", {
  description:
    "Discord gateway connection status per bot (discord.js Status enum; 0 = Ready)",
  valueType: ValueType.INT,
});

const botLatencyGauge = gatewayMeter.createObservableGauge("bot_latency", {
  description: "Discord gateway heartbeat latency per bot",
  unit: "ms",
  valueType: ValueType.INT,
});

const modmailMeter = metrics.getMeter("modmail", "1.0");

const guildOwnershipConflictCounter = modmailMeter.createCounter(
  "guild_ownership_conflicts",
  {
    description:
      "GuildOwnershipConflictError occurrences, per owning applicationId -- " +
      "a nonzero rate means two bots' guild configs are colliding on the " +
      "shared DB, almost always a misconfigured MAIL_GUILD_ID",
    valueType: ValueType.INT,
  }
);

export interface BotForMetrics {
  name: string;
  client: Client;
}

/**
 * Registers observable-gauge callbacks reporting every started bot's live
 * gateway status/latency. Poll-based (reads client.ws.status/ping on each
 * collection interval), so it reflects real-time state regardless of when
 * a bot's login settles -- same rationale as HealthcheckService's /ready.
 */
export function registerBotGatewayMetrics(bots: BotForMetrics[]): void {
  botStatusGauge.addCallback((result) => {
    for (const bot of bots) {
      result.observe(bot.client.ws.status, { bot: bot.name });
    }
  });

  botLatencyGauge.addCallback((result) => {
    for (const bot of bots) {
      result.observe(bot.client.ws.ping, { bot: bot.name });
    }
  });
}

export function recordGuildOwnershipConflict(applicationId: string): void {
  guildOwnershipConflictCounter.add(1, { applicationId });
}
