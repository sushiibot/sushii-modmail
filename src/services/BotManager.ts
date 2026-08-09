import type { Client } from "discord.js";
import { Status } from "discord.js";
import type { DB } from "database/db";
import type { GlobalConfig } from "models/botConfig.model";
import {
  BotRepository,
  DuplicateBotFieldError,
  type BotRosterEntry,
} from "repositories/bot.repository";
import { runtimeConfig, botEmojis } from "database/schema";
import { eq } from "drizzle-orm";
import { resolveApplicationId as defaultResolveApplicationId } from "config/botRegistry";
import { buildClient as defaultBuildClient } from "./botFactory";
import { getLogger } from "utils/logger";

const START_TIMEOUT_MS = 30_000;

// Injectable seam for tests -- both hit the real Discord API/gateway by
// default, so BotManager's unit tests supply fakes here instead of a
// network-dependent mock.module().
export interface BotManagerDeps {
  buildClient: typeof defaultBuildClient;
  resolveApplicationId: typeof defaultResolveApplicationId;
  startTimeoutMs: number;
}

export interface ManagedBot {
  entry: BotRosterEntry; // includes discordToken -- never leaves BotManager directly
  client: Client | null; // null when failed/not-yet-started
  lastError?: string;
}

export interface BotSummary {
  name: string;
  mailGuildId: string;
  applicationId: string;
  status: "connected" | "connecting" | "disconnected" | "failed";
  ping: number | null;
  lastError?: string;
}

// A `failed` (client-less) bot has no real gateway status code -- this
// sentinel is distinct from every discord.js Status value so it isn't
// confused with a genuine mid-session disconnect on a dashboard.
export const FAILED_GATEWAY_STATUS_SENTINEL = -1;

// Single source of truth for how a BotSummary status maps onto each
// consumer's own status vocabulary (discord.js's gateway Status enum for
// metrics, a small string label for HealthcheckService's HealthStatus) --
// both consumers look up this table instead of maintaining their own
// parallel switch statement, which could otherwise drift out of sync with
// each other or with the BotSummary["status"] union itself.
export const BOT_STATUS_CODES: Record<
  BotSummary["status"],
  {
    gatewayStatus: number;
    health: "ready" | "initializing" | "disconnected" | "error";
  }
> = {
  connected: { gatewayStatus: Status.Ready, health: "ready" },
  connecting: { gatewayStatus: Status.Connecting, health: "initializing" },
  disconnected: { gatewayStatus: Status.Disconnected, health: "disconnected" },
  failed: { gatewayStatus: FAILED_GATEWAY_STATUS_SENTINEL, health: "error" },
};

export function deriveStatus(bot: ManagedBot): BotSummary["status"] {
  if (!bot.client) {
    return "failed";
  }

  switch (bot.client.ws.status) {
    case Status.Ready:
      return "connected";
    case Status.Connecting:
    case Status.Nearly:
    case Status.WaitingForGuilds:
    case Status.Identifying:
    case Status.Resuming:
      // First-time (or post-reload) handshake states -- genuinely "still
      // starting up", distinct from having had a working connection drop.
      return "connecting";
    case Status.Reconnecting:
    case Status.Disconnected:
    case Status.Idle:
      // Reconnecting means the gateway connection was up and dropped --
      // closer to "disconnected" than to a fresh connecting bot, so a
      // flapping bot doesn't read the same as a healthy cold boot.
      return "disconnected";
  }
}

function summarize(applicationId: string, bot: ManagedBot): BotSummary {
  const status = deriveStatus(bot);

  return {
    name: bot.entry.name,
    mailGuildId: bot.entry.mailGuildId,
    applicationId,
    status,
    ping: bot.client ? bot.client.ws.ping : null,
    lastError: bot.lastError,
  };
}

export class AlreadyInProgressError extends Error {
  constructor(applicationId: string) {
    super(`An operation is already in progress for bot ${applicationId}`);
    this.name = "AlreadyInProgressError";
  }
}

/**
 * Owns every live Client for this process. Every public mutating method
 * acquires a lock (per-applicationId for add/reload/rotate, a single
 * process-wide mutex for remove, since its "would this leave zero rows"
 * guard depends on the global row count, not one app's state) around a
 * private, unlocked body -- so compound operations (e.g. rotateToken
 * calling reloadInternal calling startInternal) don't deadlock against
 * their own lock.
 */
export class BotManager {
  private bots = new Map<string, ManagedBot>();
  private inFlight = new Set<string>();
  private removeQueue: Promise<void> = Promise.resolve();

  private logger = getLogger(this.constructor.name);

  constructor(
    private readonly db: DB,
    private readonly globals: GlobalConfig,
    private readonly botRepository: BotRepository = new BotRepository(db),
    private readonly deps: BotManagerDeps = {
      buildClient: defaultBuildClient,
      resolveApplicationId: defaultResolveApplicationId,
      startTimeoutMs: START_TIMEOUT_MS,
    }
  ) {}

  private audit(
    op: string,
    applicationId: string,
    name: string,
    invokerId: string
  ): void {
    this.logger.info(
      { op, applicationId, name, invokerId },
      `Bot roster operation: ${op}`
    );
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out")), ms);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Logs a new client in for this roster entry, time-boxed. Never throws
   * -- records the result (success or failure) into the map and returns
   * it. On timeout/failure, destroys any client that did get constructed
   * so an abandoned login can't finish connecting later with no entry in
   * the map (a timed-out client.login() doesn't cancel the underlying
   * gateway handshake).
   */
  private async startInternal(
    entry: BotRosterEntry,
    applicationId: string
  ): Promise<ManagedBot> {
    // buildClient is inside the try too -- it's synchronous but not
    // guaranteed side-effect-free (constructs the command router, which
    // throws on a wiring bug like a duplicate command registration), and
    // a throw here must still land in getSummaries() as a failed entry
    // rather than propagate uncaught out of Promise.allSettled callers.
    let client: Client | null = null;

    try {
      client = this.deps.buildClient(entry, this.globals, this.db, this);

      // Registered before the login settles -- deriveStatus reads a live
      // client's ws.status as "connecting" until it's ready, so a bot
      // mid-login shows up as connecting/not-ready rather than being
      // absent from getSummaries() entirely (which would make /ready
      // read 200 with zero bots actually connected during the whole
      // login window). Also gives the timeout path below a concrete
      // client reference to destroy -- login() timing out doesn't cancel
      // the underlying gateway handshake, so an un-destroyed client
      // could finish connecting later with no entry in the map.
      this.bots.set(applicationId, { entry, client });

      await this.withTimeout(
        client.login(entry.discordToken),
        this.deps.startTimeoutMs
      );

      const managed: ManagedBot = { entry, client, lastError: undefined };
      this.bots.set(applicationId, managed);
      return managed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { err, applicationId, name: entry.name },
        `Failed to start bot "${entry.name}"`
      );

      await client?.destroy().catch(() => {});

      const managed: ManagedBot = { entry, client: null, lastError: message };
      this.bots.set(applicationId, managed);
      return managed;
    }
  }

  private async reloadInternal(applicationId: string): Promise<ManagedBot> {
    // The DB, not any in-memory entry, is the source of truth -- this is
    // what makes a rotated token actually take effect on reload.
    const entry = await this.botRepository.findByApplicationId(applicationId);
    if (!entry) {
      throw new Error(`No bot roster entry for application ${applicationId}`);
    }

    const existing = this.bots.get(applicationId);
    if (existing?.client) {
      // Intents are constructor-time -- the old client is never reused.
      await existing.client.destroy().catch(() => {});
    }

    let result = await this.startInternal(entry, applicationId);
    if (!result.client) {
      // One automatic retry before settling into a failed, retryable entry.
      result = await this.startInternal(entry, applicationId);
    }

    return result;
  }

  private async withAppLock<T>(
    applicationId: string,
    body: () => Promise<T>
  ): Promise<T> {
    if (this.inFlight.has(applicationId)) {
      throw new AlreadyInProgressError(applicationId);
    }

    this.inFlight.add(applicationId);
    try {
      return await body();
    } finally {
      this.inFlight.delete(applicationId);
    }
  }

  async addBot(
    name: string,
    token: string,
    mailGuildId: string,
    invokerId: string
  ): Promise<ManagedBot> {
    const applicationId = await this.deps.resolveApplicationId(token);

    return this.withAppLock(applicationId, async () => {
      const existing = await this.botRepository.findByApplicationId(
        applicationId
      );
      if (existing || this.bots.has(applicationId)) {
        throw new DuplicateBotFieldError(
          "This application is already registered, use rotate or reload."
        );
      }

      const entry: BotRosterEntry = {
        applicationId,
        discordToken: token,
        name,
        mailGuildId,
      };

      this.botRepository.insert(entry);

      // Row persists even if startInternal fails -- the row is the
      // desired state, live status may just lag a fixable external issue.
      const result = await this.startInternal(entry, applicationId);

      this.audit("add", applicationId, name, invokerId);
      return result;
    });
  }

  async reloadBot(
    applicationId: string,
    invokerId: string
  ): Promise<ManagedBot> {
    return this.withAppLock(applicationId, async () => {
      const result = await this.reloadInternal(applicationId);
      this.audit("reload", applicationId, result.entry.name, invokerId);
      return result;
    });
  }

  async rotateToken(
    applicationId: string,
    newToken: string,
    invokerId: string
  ): Promise<ManagedBot> {
    const resolvedApplicationId = await this.deps.resolveApplicationId(newToken);
    if (resolvedApplicationId !== applicationId) {
      throw new Error(
        "This token belongs to a different application than the bot being rotated."
      );
    }

    return this.withAppLock(applicationId, async () => {
      this.botRepository.updateToken(applicationId, newToken);
      const result = await this.reloadInternal(applicationId);
      this.audit("rotate", applicationId, result.entry.name, invokerId);
      return result;
    });
  }

  async removeBot(applicationId: string, invokerId: string): Promise<void> {
    // Goes through withAppLock too, not just the global remove mutex below
    // -- otherwise a reload/add/rotate in flight for this exact
    // applicationId (holding a live client mid-login) can race a
    // concurrent remove: the remove destroys/deletes, then the other
    // operation's startInternal resurrects a map entry -- or worse,
    // succeeds and leaves a live gateway connection for a bot with no DB
    // row. withAppLock covers the whole critical section, not just a
    // point-in-time check, so a reload/add/rotate that starts mid-remove
    // is rejected too.
    const run = () =>
      this.withAppLock(applicationId, () =>
        this.removeBotUnlocked(applicationId, invokerId)
      );

    // Serialized process-wide on top of that: two concurrent removes of
    // *different* bots could otherwise both read "rowCount > 1" and both
    // proceed to zero, since that guard depends on the global row count,
    // not any one applicationId's lock.
    const next = this.removeQueue.then(run, run);
    this.removeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async removeBotUnlocked(
    applicationId: string,
    invokerId: string
  ): Promise<void> {
    const existing = this.bots.get(applicationId);
    const dbEntry = await this.botRepository.findByApplicationId(applicationId);

    if (!dbEntry) {
      throw new Error(`No bot roster entry for application ${applicationId}`);
    }

    const rowCount = await this.botRepository.count();
    if (rowCount <= 1) {
      throw new Error(
        "Refusing to remove the last remaining bot -- would leave zero bots configured."
      );
    }

    const name = existing?.entry.name ?? dbEntry.name;

    if (existing?.client) {
      await existing.client.destroy().catch(() => {});
    }

    this.db.transaction((tx) => {
      tx.update(runtimeConfig)
        .set({ applicationId: null })
        .where(eq(runtimeConfig.applicationId, applicationId))
        .run();
      tx.delete(botEmojis)
        .where(eq(botEmojis.applicationId, applicationId))
        .run();
      this.botRepository.delete(applicationId, tx);
    });

    this.bots.delete(applicationId);
    this.audit("remove", applicationId, name, invokerId);
  }

  getSummaries(): BotSummary[] {
    return [...this.bots.entries()].map(([applicationId, bot]) =>
      summarize(applicationId, bot)
    );
  }

  async destroyAll(): Promise<void> {
    await Promise.allSettled(
      [...this.bots.values()].map((b) => b.client?.destroy())
    );
  }

  /**
   * Boot-time only. Still goes through withAppLock per entry (even though
   * nothing else can be running yet) so a boot-time start for a given
   * applicationId can never race an admin command for that same id --
   * without this, a `bot reload`/`remove` issued the instant one bot
   * finishes logging in (while others are still starting) could run
   * concurrently with this method's own in-flight startInternal call for
   * that id and clobber or orphan whichever client loses the race.
   */
  async startAllForBoot(roster: BotRosterEntry[]): Promise<void> {
    await Promise.allSettled(
      roster.map((entry) =>
        this.withAppLock(entry.applicationId, () =>
          this.startInternal(entry, entry.applicationId)
        )
      )
    );
  }
}
