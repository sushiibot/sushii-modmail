import {
  ValueType,
  metrics,
  type Counter,
  type ObservableGauge,
} from "@opentelemetry/api";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import {
  BOT_STATUS_CODES,
  FAILED_GATEWAY_STATUS_SENTINEL,
  type BotSummary,
} from "services/BotManager";
import { getCurrentBot } from "./botContext";
import { getRegisteredThreadRepository } from "./threadMetricsRegistry";

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

let messageRelayCounter: Counter | undefined;
let threadOpenedCounter: Counter | undefined;
let threadClosedCounter: Counter | undefined;
let commandInvocationCounter: Counter | undefined;
let snippetUsageCounter: Counter | undefined;
let messageEditDeleteCounter: Counter | undefined;
let openThreadsGauge: ObservableGauge | undefined;

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

  // discord_gateway_* prefix distinguishes these from modmail's own
  // internal metrics (e.g. guild_ownership_conflict_active) -- these
  // describe discord.js's connection state, not modmail's own logic.
  // Labeled by bot name instead of shard id since each modmail bot is
  // its own unsharded Client.
  botStatusGauge = gatewayMeter.createObservableGauge("discord_gateway_status", {
    description:
      "Discord gateway connection status per bot (discord.js Status enum; 0 = Ready)",
    valueType: ValueType.INT,
  });

  botLatencyGauge = gatewayMeter.createObservableGauge("discord_gateway_latency", {
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

  messageRelayCounter = modmailMeter.createCounter("message_relay_total", {
    description:
      "Messages relayed between users and staff, by direction and outcome",
  });

  threadOpenedCounter = modmailMeter.createCounter("thread_opened_total", {
    description: "Modmail threads opened, by how they were initiated",
  });

  threadClosedCounter = modmailMeter.createCounter("thread_closed_total", {
    description: "Modmail threads closed, by reason",
  });

  commandInvocationCounter = modmailMeter.createCounter(
    "command_invocation_total",
    { description: "Text commands invoked, by command name and outcome" }
  );

  snippetUsageCounter = modmailMeter.createCounter("snippet_usage_total", {
    description: "Snippets relayed to users",
  });

  messageEditDeleteCounter = modmailMeter.createCounter(
    "message_edit_delete_total",
    {
      description:
        "Message edit/delete relay events, by direction and outcome",
    }
  );

  openThreadsGauge = modmailMeter.createObservableGauge("open_threads", {
    description: "Currently open modmail threads",
    valueType: ValueType.INT,
  });
}

/**
 * Registers the open-threads gauge callback, reading `getSummaries()` fresh
 * on each collection interval (same reasoning as registerBotGatewayMetrics
 * below) so a removed bot drops out of the gauge instead of leaving a stale
 * row behind forever -- registerBotThreadRepository's registry is
 * append-only and never unregisters a removed bot on its own. Called ONCE
 * at boot, after initMetrics().
 */
export function registerOpenThreadsMetrics(
  getSummaries: () => BotSummary[]
): void {
  if (!openThreadsGauge) {
    throw new Error("registerOpenThreadsMetrics called before initMetrics()");
  }

  openThreadsGauge.addCallback(async (result) => {
    for (const bot of getSummaries()) {
      const repo = getRegisteredThreadRepository(bot.name);
      if (!repo) {
        continue;
      }

      const openCount = await repo.countOpenThreads();
      result.observe(openCount, { bot: bot.name });
    }
  });
}

/**
 * Maps a caught error onto a small, closed set of label values -- never the
 * raw error message or any Discord ID, which would blow up label
 * cardinality in Mimir.
 */
export function classifyDiscordError(err: unknown): string {
  if (err instanceof DiscordAPIError) {
    switch (err.code) {
      case RESTJSONErrorCodes.CannotSendMessagesToThisUser:
        return "dm_blocked";
      case RESTJSONErrorCodes.UnknownChannel:
      case RESTJSONErrorCodes.UnknownMessage:
        return "unknown_channel";
      case RESTJSONErrorCodes.MissingPermissions:
      case RESTJSONErrorCodes.MissingAccess:
        return "missing_permissions";
      default:
        return "discord_api_other";
    }
  }

  return "other";
}

export function recordMessageRelay(
  direction: "user_to_staff" | "staff_to_user",
  result: "success" | "failure",
  errorType?: string
): void {
  messageRelayCounter?.add(1, {
    bot: getCurrentBot() ?? "unknown",
    direction,
    result,
    ...(errorType ? { error_type: errorType } : {}),
  });
}

export function recordThreadOpened(source: "dm" | "staff_contact"): void {
  threadOpenedCounter?.add(1, { bot: getCurrentBot() ?? "unknown", source });
}

export function recordThreadClosed(
  reason: "staff" | "system_missing_channel"
): void {
  threadClosedCounter?.add(1, { bot: getCurrentBot() ?? "unknown", reason });
}

export function recordCommandInvocation(
  command: string,
  subcommand: string | null,
  result: "success" | "failure"
): void {
  commandInvocationCounter?.add(1, {
    bot: getCurrentBot() ?? "unknown",
    command,
    ...(subcommand ? { subcommand } : {}),
    result,
  });
}

export function recordSnippetUsage(): void {
  snippetUsageCounter?.add(1, { bot: getCurrentBot() ?? "unknown" });
}

export function recordMessageEditDelete(
  event: "user_edit" | "user_delete" | "staff_edit" | "staff_delete",
  result: "success" | "failure"
): void {
  messageEditDeleteCounter?.add(1, {
    bot: getCurrentBot() ?? "unknown",
    event,
    result,
  });
}

/**
 * Registers observable-gauge callbacks reporting every started bot's live
 * gateway status/latency, reading `getSummaries()` fresh on each
 * collection interval rather than closing over a fixed array -- so a bot
 * added/removed/reloaded after boot is reflected without re-registering
 * callbacks (registering twice would leak + produce duplicate/
 * nondeterministic readings over destroyed clients). Called ONCE at boot,
 * after initMetrics().
 */
export function registerBotGatewayMetrics(
  getSummaries: () => BotSummary[]
): void {
  if (!botStatusGauge || !botLatencyGauge) {
    throw new Error("registerBotGatewayMetrics called before initMetrics()");
  }

  botStatusGauge.addCallback((result) => {
    for (const bot of getSummaries()) {
      result.observe(BOT_STATUS_CODES[bot.status].gatewayStatus, {
        bot: bot.name,
      });
    }
  });

  botLatencyGauge.addCallback((result) => {
    for (const bot of getSummaries()) {
      // A failed bot still emits a row via the sentinel value below
      // rather than being omitted entirely -- gated on `status`
      // explicitly rather than `bot.ping ?? sentinel`, so this doesn't
      // rely on the (currently true, but not enforced by the type)
      // invariant that ping is only ever null when status is "failed".
      const ping =
        bot.status === "failed"
          ? FAILED_GATEWAY_STATUS_SENTINEL
          : bot.ping ?? FAILED_GATEWAY_STATUS_SENTINEL;
      result.observe(ping, { bot: bot.name });
    }
  });
}

export function recordGuildOwnershipConflict(applicationId: string): void {
  conflictedApplicationIds.add(applicationId);
}
