import { describe, it, expect, afterEach } from "bun:test";
import { EventEmitter } from "events";
import { Events, type Client } from "discord.js";
import { getDb } from "../database/db";
import { registerEventHandlers } from "../events";
import CommandRouter from "../CommandRouter";
import { RuntimeConfigRepository } from "../repositories/runtimeConfig.repository";
import { runtimeConfig } from "../database/schema";
import { BotConfig, type GlobalConfig } from "../models/botConfig.model";

const globals: GlobalConfig = {
  LOG_LEVEL: "info",
  DATABASE_URI: ":memory:",
  HEALTHCHECK_PORT: 3000,
};

function makeFakeClient(
  guildsFetch: (id: string) => Promise<unknown> = async () => ({})
): Client {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    user: {
      id: "bot-user-id",
      tag: "TestBot#0000",
      setPresence: () => {},
    },
    guilds: { fetch: guildsFetch },
  }) as unknown as Client;
}

async function wireBot(
  name: string,
  discordClientId: string,
  guildId: string,
  guildsFetch?: (id: string) => Promise<unknown>
) {
  const db = getDb(":memory:");
  const config = BotConfig.fromRosterEntry(
    { name, discordToken: "token", mailGuildId: guildId },
    discordClientId,
    globals
  );
  const runtimeConfigRepository = new RuntimeConfigRepository(
    db,
    config.discordClientId
  );
  const commandRouter = new CommandRouter(runtimeConfigRepository, config);
  const client = makeFakeClient(guildsFetch);

  registerEventHandlers(config, client, db, commandRouter);

  return { db, config, client };
}

// events.ts's ClientReady handler calls updateBotPresence(...), which calls
// RuntimeConfigRepository.getConfig(guildId) -- a real call path that throws
// GuildOwnershipConflictError when a guild's runtimeConfig row is owned by a
// different bot's applicationId (see runtimeConfig.repository.ts). These
// tests drive that error through the actual registerEventHandlers wiring
// (not a hand-rolled Promise.allSettled scenario), confirming the real
// try/catch inside updateBotPresence -- installed via the real ClientReady
// listener -- absorbs it rather than crashing the process or leaking into
// process-level unhandledRejection, and that a second, unrelated bot's own
// dispatch is unaffected.
describe("GuildOwnershipConflictError fault isolation (via registerEventHandlers)", () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  afterEach(() => {
    process.off("unhandledRejection", onUnhandledRejection);
    unhandledRejections.length = 0;
  });

  it("a real GuildOwnershipConflictError during ClientReady is caught and does not crash or propagate", async () => {
    const guildId = "111111111111111111";
    const { db, client } = await wireBot("lisa", "this-app-id", guildId);

    // Seed the guild's runtimeConfig row as owned by a different bot, so
    // this bot's own ClientReady -> updateBotPresence -> getConfig call
    // hits the real GuildOwnershipConflictError path.
    await db.insert(runtimeConfig).values({
      guildId,
      applicationId: "other-app-id",
      requiredRoleIds: "[]",
    });

    process.on("unhandledRejection", onUnhandledRejection);

    expect(() =>
      (client as unknown as EventEmitter).emit(Events.ClientReady, client)
    ).not.toThrow();

    // Let the async ClientReady handler run to completion.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandledRejections).toEqual([]);
  });

  it("one bot's GuildOwnershipConflictError does not affect a second, unrelated bot's dispatch", async () => {
    const conflictedGuildId = "222222222222222222";
    const healthyGuildId = "333333333333333333";

    const bad = await wireBot("lisa", "app-lisa", conflictedGuildId);
    const good = await wireBot("bp", "app-bp", healthyGuildId);

    await bad.db.insert(runtimeConfig).values({
      guildId: conflictedGuildId,
      applicationId: "some-other-app",
      requiredRoleIds: "[]",
    });

    process.on("unhandledRejection", onUnhandledRejection);

    (bad.client as unknown as EventEmitter).emit(Events.ClientReady, bad.client);
    (good.client as unknown as EventEmitter).emit(
      Events.ClientReady,
      good.client
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandledRejections).toEqual([]);

    // The healthy bot's own guild was never touched by the conflicted
    // bot's error -- its runtimeConfig claim went through normally.
    const goodRepo = new RuntimeConfigRepository(good.db, "app-bp");
    const goodConfig = await goodRepo.getConfig(healthyGuildId);
    expect(goodConfig.guildId).toBe(healthyGuildId);
  });
});

// events.ts's ClientReady handler fetches config.guildId via
// client.guilds.fetch to confirm the bot is actually a member of its
// configured mailGuildId -- catches a mispasted BOT_N_MAIL_GUILD_ID the
// same way resolveApplicationId (botRegistry.ts) catches a mispasted
// client id.
describe("guild membership check (via registerEventHandlers)", () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  afterEach(() => {
    process.off("unhandledRejection", onUnhandledRejection);
    unhandledRejections.length = 0;
  });

  it("fetches the configured guild on startup", async () => {
    const guildId = "444444444444444444";
    const fetchedIds: string[] = [];
    const { client } = await wireBot("lisa", "app-id", guildId, async (id) => {
      fetchedIds.push(id);
      return {};
    });

    (client as unknown as EventEmitter).emit(Events.ClientReady, client);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchedIds).toEqual([guildId]);
  });

  it("logs and continues (does not crash) when the bot is not a member of its configured guild", async () => {
    const guildId = "555555555555555555";
    const { client } = await wireBot("lisa", "app-id", guildId, async () => {
      throw new Error("Unknown Guild");
    });

    process.on("unhandledRejection", onUnhandledRejection);

    expect(() =>
      (client as unknown as EventEmitter).emit(Events.ClientReady, client)
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandledRejections).toEqual([]);
  });
});
