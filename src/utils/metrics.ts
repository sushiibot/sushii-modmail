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

// MAIL_GUILD_ID only changes on a redeploy, so once a conflict is
// observed it stays true for the rest of this process's life -- there's
// no "it went away" until a restart with corrected config. A counter with
// a rolling window would be misleading here: it resolves as soon as the
// misconfigured guild goes quiet for one window, even though nothing was
// fixed. Track it as a sticky gauge instead, set once and never cleared.
const conflictedApplicationIds = new Set<string>();

const guildOwnershipConflictGauge = modmailMeter.createObservableGauge(
  "guild_ownership_conflict_active",
  {
    description:
      "1 if a GuildOwnershipConflictError has been observed for this " +
      "owning applicationId since process start, else absent -- a known, " +
      "unresolved MAIL_GUILD_ID misconfiguration, not an event rate",
    valueType: ValueType.INT,
  }
);

guildOwnershipConflictGauge.addCallback((result) => {
  for (const applicationId of conflictedApplicationIds) {
    result.observe(1, { applicationId });
  }
});

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
  conflictedApplicationIds.add(applicationId);
}
