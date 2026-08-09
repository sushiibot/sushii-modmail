import { describe, it, expect, beforeEach } from "bun:test";
import { getDb } from "../../database/db";
import { BotRepository } from "../../repositories/bot.repository";
import { seedIfNeeded } from "../../services/botSeed";
import type { BotRegistry } from "../../config/botRegistry";

function fakeRegistry(
  configs: { name: string; discordToken: string; mailGuildId: string }[]
): BotRegistry {
  return { getBotConfigs: () => configs };
}

function throwingRegistry(message: string): BotRegistry {
  return {
    getBotConfigs: () => {
      throw new Error(message);
    },
  };
}

describe("seedIfNeeded", () => {
  let db: ReturnType<typeof getDb>;
  let botRepository: BotRepository;

  beforeEach(() => {
    db = getDb(":memory:");
    botRepository = new BotRepository(db);
  });

  it("seeds from env when not yet seeded", async () => {
    const envRegistry = fakeRegistry([
      { name: "lisa", discordToken: "token-1", mailGuildId: "111111111111111111" },
      { name: "bp", discordToken: "token-2", mailGuildId: "222222222222222222" },
    ]);

    await seedIfNeeded(db, botRepository, {
      envRegistry,
      resolveApplicationId: async (token) =>
        token === "token-1" ? "100000000000000001" : "100000000000000002",
    });

    expect(await botRepository.count()).toBe(2);
    expect(await botRepository.isSeeded()).toBe(true);
  });

  it("does not reseed on a second call (no-op when already seeded)", async () => {
    const envRegistry = fakeRegistry([
      { name: "lisa", discordToken: "token-1", mailGuildId: "111111111111111111" },
    ]);
    const deps = {
      envRegistry,
      resolveApplicationId: async () => "100000000000000001",
    };

    await seedIfNeeded(db, botRepository, deps);
    botRepository.delete("100000000000000001");

    // Removing every bot row and re-running must NOT resurrect from env --
    // the seed marker, not the row count, gates this.
    await seedIfNeeded(db, botRepository, deps);

    expect(await botRepository.count()).toBe(0);
  });

  it("throws a specific bootstrap message when the env registry has zero entries, and does not mark seeded", async () => {
    const deps = {
      envRegistry: throwingRegistry("no roster entries"),
      resolveApplicationId: async () => "100000000000000001",
    };

    await expect(seedIfNeeded(db, botRepository, deps)).rejects.toThrow(
      /No bots configured/
    );
    expect(await botRepository.isSeeded()).toBe(false);
  });

  it("aborts the entire seed (all-or-nothing) when one entry's application id can't be resolved", async () => {
    const envRegistry = fakeRegistry([
      { name: "lisa", discordToken: "token-1", mailGuildId: "111111111111111111" },
      { name: "bp", discordToken: "bad-token", mailGuildId: "222222222222222222" },
    ]);

    await expect(
      seedIfNeeded(db, botRepository, {
        envRegistry,
        resolveApplicationId: async (token) => {
          if (token === "bad-token") {
            throw new Error("invalid token");
          }
          return "100000000000000001";
        },
      })
    ).rejects.toThrow(/First-boot seed failed/);

    // Nothing partially committed, and not marked seeded -- a fixed
    // config can retry cleanly on the next boot.
    expect(await botRepository.count()).toBe(0);
    expect(await botRepository.isSeeded()).toBe(false);
  });

  it("rolls back the whole seed transaction when a later insert fails mid-transaction", async () => {
    // Both entries resolve application ids successfully -- the failure
    // must come from inside db.transaction(...) itself (a duplicate
    // mailGuildId insert), proving the transaction body is genuinely
    // synchronous/atomic rather than the earlier resolution loop.
    const envRegistry = fakeRegistry([
      { name: "lisa", discordToken: "token-1", mailGuildId: "111111111111111111" },
      { name: "bp", discordToken: "token-2", mailGuildId: "111111111111111111" },
    ]);

    await expect(
      seedIfNeeded(db, botRepository, {
        envRegistry,
        resolveApplicationId: async (token) =>
          token === "token-1" ? "100000000000000001" : "100000000000000002",
      })
    ).rejects.toThrow();

    expect(await botRepository.count()).toBe(0);
    expect(await botRepository.isSeeded()).toBe(false);
  });
});
