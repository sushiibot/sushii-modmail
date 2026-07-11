import { ValueType, metrics, type ObservableGauge } from "@opentelemetry/api";
import type { Client } from "discord.js";

// MAIL_GUILD_ID only changes on a redeploy, so once a conflict is
// observed it stays true for the rest of this process's life -- there's
// no "it went away" until a restart with corrected config. A counter with
// a rolling window would be misleading here: it resolves as soon as the
// misconfigured guild goes quiet for one window, even though nothing was
// fixed. Track it as a sticky gauge instead, set once and never cleared.
const conflictedApplicationIds = new Set<string>();

let botStatusGauge: ObservableGauge | undefined;
let botLatencyGauge: ObservableGauge | undefined;
let guildOwnershipConflictGauge: ObservableGauge | undefined;

export interface BotForMetrics {
  name: string;
  client: Client;
}

/**
 * Creates every metric instrument. Must be called after setupOtel() has
 * registered the real MeterProvider globally -- metrics.getMeter()
 * resolves the *currently* registered provider synchronously (it is not
 * a lazy proxy in this API version: see MetricsAPI.getMeter in
 * @opentelemetry/api). Creating instruments at module-import time, before
 * setupOtel() runs, would silently bind them to the default no-op
 * provider forever -- no error, the instruments just never record or
 * export anything. (Confirmed the hard way: this shipped broken for a
 * full deploy cycle with zero errors anywhere in the pipeline.)
 */
export function initMetrics(): void {
  const gatewayMeter = metrics.getMeter("gateway", "1.0");

  // Mirrors sushii-bot's shard_status/shard_latency pattern (see
  // packages/sushii-worker/.../CoreMetrics.ts), labeled by bot name
  // instead of shard id since each modmail bot is its own unsharded Client.
  botStatusGauge = gatewayMeter.createObservableGauge("bot_status", {
    description:
      "Discord gateway connection status per bot (discord.js Status enum; 0 = Ready)",
    valueType: ValueType.INT,
  });

  botLatencyGauge = gatewayMeter.createObservableGauge("bot_latency", {
    description: "Discord gateway heartbeat latency per bot",
    unit: "ms",
    valueType: ValueType.INT,
  });

  const modmailMeter = metrics.getMeter("modmail", "1.0");

  guildOwnershipConflictGauge = modmailMeter.createObservableGauge(
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
}

/**
 * Registers observable-gauge callbacks reporting every started bot's live
 * gateway status/latency. Poll-based (reads client.ws.status/ping on each
 * collection interval), so it reflects real-time state regardless of when
 * a bot's login settles -- same rationale as HealthcheckService's /ready.
 * Must be called after initMetrics().
 */
export function registerBotGatewayMetrics(bots: BotForMetrics[]): void {
  if (!botStatusGauge || !botLatencyGauge) {
    throw new Error("registerBotGatewayMetrics called before initMetrics()");
  }

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
