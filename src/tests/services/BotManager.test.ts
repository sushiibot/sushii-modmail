import { describe, it, expect, beforeEach } from "bun:test";
import { Status } from "discord.js";
import { getDb } from "../../database/db";
import { BotRepository } from "../../repositories/bot.repository";
import {
  BotManager,
  AlreadyInProgressError,
  deriveStatus,
  type BotManagerDeps,
  type ManagedBot,
} from "../../services/BotManager";
import type { GlobalConfig } from "../../models/botConfig.model";
import { runtimeConfig, botEmojis } from "../../database/schema";

const globals: GlobalConfig = {
  LOG_LEVEL: "info",
  DATABASE_URI: ":memory:",
  HEALTHCHECK_PORT: 3000,
};

function fakeClient(opts: { failLogin?: boolean; hang?: boolean } = {}) {
  let destroyed = false;
  const client = {
    ws: { status: Status.Ready, ping: 12 },
    login: async () => {
      if (opts.hang) {
        return new Promise(() => {});
      }
      if (opts.failLogin) {
        throw new Error("invalid token");
      }
      return "ok";
    },
    destroy: async () => {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
  return client;
}

/** Builds a BotManagerDeps whose resolveApplicationId returns a fixed id
 * for a given token, and whose buildClient hands back canned fake clients
 * keyed by applicationId (falling back to a healthy client). */
function makeDeps(opts: {
  tokenToAppId?: Record<string, string>;
  clientsByAppId?: Record<string, ReturnType<typeof fakeClient>>;
} = {}): BotManagerDeps & { clientsByAppId: Record<string, any> } {
  const clientsByAppId = opts.clientsByAppId ?? {};

  return {
    clientsByAppId,
    startTimeoutMs: 30_000,
    resolveApplicationId: async (token: string) => {
      const mapped = opts.tokenToAppId?.[token];
      if (mapped) {
        return mapped;
      }
      // Default: token "token-<n>" resolves to a numeric applicationId.
      const match = token.match(/^token-(\d+)(?:-rotated)?$/);
      if (match) {
        return `10000000000000000${match[1]}`;
      }
      throw new Error(`No mapping for token ${token}`);
    },
    buildClient: (entry) => {
      const existing = clientsByAppId[entry.applicationId];
      if (existing) {
        return existing as any;
      }
      const created = fakeClient();
      clientsByAppId[entry.applicationId] = created;
      return created as any;
    },
  };
}

describe("BotManager", () => {
  let db: ReturnType<typeof getDb>;
  let botRepository: BotRepository;

  beforeEach(() => {
    db = getDb(":memory:");
    botRepository = new BotRepository(db);
  });

  describe("addBot", () => {
    it("persists the row and starts the client", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);

      const result = await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      expect(result.client).not.toBeNull();
      expect(await botRepository.findByApplicationId("100000000000000001")).not.toBeNull();
    });

    it("persists the row even when startInternal fails", async () => {
      const deps = makeDeps({
        clientsByAppId: { "100000000000000001": fakeClient({ failLogin: true }) as any },
      });
      const manager = new BotManager(db, globals, botRepository, deps);

      const result = await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      expect(result.client).toBeNull();
      expect(result.lastError).toBeDefined();
      expect(await botRepository.findByApplicationId("100000000000000001")).not.toBeNull();
    });

    it("rejects adding an already-registered application", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);

      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      await expect(
        manager.addBot(
          "lisa-dupe",
          "token-1",
          "222222222222222222",
          "invoker-1"
        )
      ).rejects.toThrow();
    });

    it("records a failed entry (does not throw out of addBot) when buildClient itself throws synchronously", async () => {
      const deps = makeDeps();
      deps.buildClient = () => {
        throw new Error("wiring bug: duplicate command registered");
      };
      const manager = new BotManager(db, globals, botRepository, deps);

      const result = await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      expect(result.client).toBeNull();
      expect(result.lastError).toContain("duplicate command registered");
      expect(manager.getSummaries()).toEqual([
        expect.objectContaining({
          applicationId: "100000000000000001",
          status: "failed",
        }),
      ]);
    });
  });

  describe("reloadBot", () => {
    it("re-reads the DB entry -- a rotated token actually takes effect", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);

      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      // Simulate a rotation having already updated the DB row directly
      // (bypassing rotateToken) to isolate reloadBot's own DB-is-source-
      // of-truth behavior.
      botRepository.updateToken("100000000000000001", "token-1-rotated");

      const usedTokens: string[] = [];
      deps.buildClient = (entry) => {
        usedTokens.push(entry.discordToken);
        return fakeClient() as any;
      };

      await manager.reloadBot("100000000000000001", "invoker-1");

      expect(usedTokens[usedTokens.length - 1]).toBe(
        "token-1-rotated"
      );
    });

    it("retries once before settling into a failed, retryable entry", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      let attempts = 0;
      deps.buildClient = () => {
        attempts += 1;
        return fakeClient({ failLogin: true }) as any;
      };

      const result = await manager.reloadBot("100000000000000001", "invoker-1");

      expect(attempts).toBe(2);
      expect(result.client).toBeNull();
    });

    it("rejects a concurrent second operation on the same applicationId", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      let resolveLogin: () => void = () => {};
      deps.buildClient = () => {
        return {
          ws: { status: Status.Ready, ping: 1 },
          login: () => new Promise<void>((resolve) => (resolveLogin = resolve)),
          destroy: async () => {},
        } as any;
      };

      const first = manager.reloadBot("100000000000000001", "invoker-1");
      const second = manager.reloadBot("100000000000000001", "invoker-1");

      await expect(second).rejects.toThrow(AlreadyInProgressError);

      resolveLogin();
      await first;
    });
  });

  describe("rotateToken", () => {
    it("rejects when the new token resolves to a different application", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      await expect(
        manager.rotateToken("100000000000000001", "token-2", "invoker-1")
      ).rejects.toThrow();
    });

    it("updates the token and reloads with it", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      deps.resolveApplicationId = async () => "100000000000000001";
      const usedTokens: string[] = [];
      deps.buildClient = (entry) => {
        usedTokens.push(entry.discordToken);
        return fakeClient() as any;
      };

      await manager.rotateToken("100000000000000001", "brand-new-token", "invoker-1");

      const row = await botRepository.findByApplicationId("100000000000000001");
      expect(row?.discordToken).toBe("brand-new-token");
      expect(usedTokens[usedTokens.length - 1]).toBe("brand-new-token");
    });
  });

  describe("removeBot", () => {
    it("refuses to remove the last remaining bot", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      await expect(manager.removeBot("100000000000000001", "invoker-1")).rejects.toThrow();
      expect(await botRepository.count()).toBe(1);
    });

    it("allows removal down to the last row when more than one exists, even if all are failed", async () => {
      const deps = makeDeps({
        clientsByAppId: {
          "100000000000000001": fakeClient({ failLogin: true }) as any,
          "100000000000000002": fakeClient({ failLogin: true }) as any,
        },
      });
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );
      await manager.addBot(
        "bp",
        "token-2",
        "222222222222222222",
        "invoker-1"
      );

      await manager.removeBot("100000000000000001", "invoker-1");
      expect(await botRepository.count()).toBe(1);

      await expect(manager.removeBot("100000000000000002", "invoker-1")).rejects.toThrow();
    });

    it("clears runtimeConfig and botEmojis ownership for the removed applicationId", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );
      await manager.addBot(
        "bp",
        "token-2",
        "222222222222222222",
        "invoker-1"
      );

      await db.insert(runtimeConfig).values({
        guildId: "111111111111111111",
        applicationId: "100000000000000001",
        requiredRoleIds: "[]",
      });
      await db.insert(botEmojis).values({
        id: "999999999999999999",
        name: "logs",
        sha256: "abc",
        applicationId: "100000000000000001",
      });

      await manager.removeBot("100000000000000001", "invoker-1");

      const configRows = await db.select().from(runtimeConfig).execute();
      expect(configRows[0].applicationId).toBeNull();

      const emojiRows = await db.select().from(botEmojis).execute();
      expect(emojiRows.length).toBe(0);
    });

    it("two concurrent removals of different bots both succeed via serialization", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );
      await manager.addBot(
        "bp",
        "token-2",
        "222222222222222222",
        "invoker-1"
      );
      await manager.addBot(
        "twice",
        "token-3",
        "333333333333333333",
        "invoker-1"
      );

      await Promise.all([
        manager.removeBot("100000000000000001", "invoker-1"),
        manager.removeBot("100000000000000002", "invoker-1"),
      ]);

      expect(await botRepository.count()).toBe(1);
    });

    it("rejects a remove that races an in-flight reload of the same applicationId", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );
      await manager.addBot(
        "bp",
        "token-2",
        "222222222222222222",
        "invoker-1"
      );

      let resolveLogin: () => void = () => {};
      deps.buildClient = () =>
        ({
          ws: { status: Status.Ready, ping: 1 },
          login: () =>
            new Promise<void>((resolve) => (resolveLogin = resolve)),
          destroy: async () => {},
        } as any);

      const reload = manager.reloadBot("100000000000000001", "invoker-1");

      await expect(
        manager.removeBot("100000000000000001", "invoker-1")
      ).rejects.toThrow(AlreadyInProgressError);

      // The row must survive the rejected remove, and the reload must
      // still be able to finish normally afterward.
      expect(await botRepository.count()).toBe(2);

      resolveLogin();
      await reload;

      expect(manager.getSummaries().find(
        (s) => s.applicationId === "100000000000000001"
      )?.status).toBe("connected");
    });
  });

  describe("getSummaries", () => {
    it("never exposes a Client or token, only a BotSummary", async () => {
      const deps = makeDeps();
      const manager = new BotManager(db, globals, botRepository, deps);
      await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      const summaries = manager.getSummaries();
      expect(summaries).toEqual([
        {
          name: "lisa",
          mailGuildId: "111111111111111111",
          applicationId: "100000000000000001",
          status: "connected",
          ping: 12,
          lastError: undefined,
        },
      ]);
    });
  });

  describe("startInternal timeout", () => {
    it("destroys the abandoned client and records a failed entry", async () => {
      const deps = makeDeps();
      deps.startTimeoutMs = 20;
      const manager = new BotManager(db, globals, botRepository, deps);

      const hangingClient = fakeClient({ hang: true });
      deps.buildClient = () => hangingClient as any;

      const result = await manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      expect(result.client).toBeNull();
      expect(hangingClient.destroyed).toBe(true);
    });

    it("reports the bot as \"connecting\" while a login is in flight, not absent", async () => {
      const deps = makeDeps();
      deps.startTimeoutMs = 200;
      const manager = new BotManager(db, globals, botRepository, deps);

      deps.buildClient = () =>
        ({
          ws: { status: Status.Connecting, ping: -1 },
          login: () => new Promise(() => {}), // never resolves -- forces a timeout
          destroy: async () => {},
        } as any);

      const addPromise = manager.addBot(
        "lisa",
        "token-1",
        "111111111111111111",
        "invoker-1"
      );

      // Give startInternal a tick to register the in-flight entry before
      // the login settles (via the 200ms timeout above).
      await new Promise((resolve) => setTimeout(resolve, 5));

      const summaries = manager.getSummaries();
      expect(summaries.length).toBe(1);
      expect(summaries[0].status).toBe("connecting");

      await addPromise;
    });
  });
});

describe("deriveStatus", () => {
  const entry = {
    applicationId: "100000000000000001",
    discordToken: "token-1",
    name: "lisa",
    mailGuildId: "111111111111111111",
  };

  function managedWithWsStatus(wsStatus: Status): ManagedBot {
    return {
      entry,
      client: { ws: { status: wsStatus, ping: 1 } } as any,
    };
  }

  it("maps failed (no client) to \"failed\"", () => {
    expect(deriveStatus({ entry, client: null })).toBe("failed");
  });

  it("maps Ready to \"connected\"", () => {
    expect(deriveStatus(managedWithWsStatus(Status.Ready))).toBe("connected");
  });

  it("maps first-time handshake states to \"connecting\"", () => {
    for (const s of [
      Status.Connecting,
      Status.Nearly,
      Status.WaitingForGuilds,
      Status.Identifying,
      Status.Resuming,
    ]) {
      expect(deriveStatus(managedWithWsStatus(s))).toBe("connecting");
    }
  });

  it("maps Reconnecting to \"disconnected\", distinct from a fresh connect (not lumped into \"connecting\")", () => {
    expect(deriveStatus(managedWithWsStatus(Status.Reconnecting))).toBe(
      "disconnected"
    );
  });

  it("maps Disconnected and Idle to \"disconnected\"", () => {
    expect(deriveStatus(managedWithWsStatus(Status.Disconnected))).toBe(
      "disconnected"
    );
    expect(deriveStatus(managedWithWsStatus(Status.Idle))).toBe(
      "disconnected"
    );
  });
});
