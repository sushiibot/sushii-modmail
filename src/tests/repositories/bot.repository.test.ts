import { describe, it, expect, beforeEach } from "bun:test";
import { getDb } from "../../database/db";
import {
  BotRepository,
  DuplicateBotFieldError,
  type BotRosterEntry,
} from "../../repositories/bot.repository";

describe("BotRepository", () => {
  let db: ReturnType<typeof getDb>;
  let repo: BotRepository;

  const entry: BotRosterEntry = {
    applicationId: "111111111111111111",
    discordToken: "token-1",
    name: "lisa",
    mailGuildId: "222222222222222222",
  };

  beforeEach(() => {
    db = getDb(":memory:");
    repo = new BotRepository(db);
  });

  describe("uniqueness", () => {
    it("rejects a duplicate discordToken with a friendly message, no token leaked", () => {
      repo.insert(entry);

      let thrown: unknown;
      try {
        repo.insert({
          ...entry,
          applicationId: "333333333333333333",
          mailGuildId: "444444444444444444",
          name: "bp",
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DuplicateBotFieldError);
      expect(String(thrown)).not.toContain(entry.discordToken);
    });

    it("rejects a duplicate mailGuildId with a friendly message", () => {
      repo.insert(entry);

      expect(() =>
        repo.insert({
          ...entry,
          applicationId: "333333333333333333",
          discordToken: "token-2",
          name: "bp",
        })
      ).toThrow(DuplicateBotFieldError);
    });

    it("rejects a duplicate name case-insensitively", () => {
      repo.insert(entry);

      expect(() =>
        repo.insert({
          ...entry,
          applicationId: "333333333333333333",
          discordToken: "token-2",
          mailGuildId: "444444444444444444",
          name: "LISA",
        })
      ).toThrow(DuplicateBotFieldError);
    });

    it("rejects a duplicate applicationId", () => {
      repo.insert(entry);

      expect(() =>
        repo.insert({
          ...entry,
          discordToken: "token-2",
          mailGuildId: "444444444444444444",
          name: "bp",
        })
      ).toThrow(DuplicateBotFieldError);
    });
  });

  describe("check constraints", () => {
    it("rejects an empty-string mailGuildId (GLOB alone is satisfied by '')", () => {
      expect(() =>
        repo.insert({ ...entry, mailGuildId: "" })
      ).toThrow();
    });

    it("rejects an empty-string applicationId (GLOB alone is satisfied by '')", () => {
      expect(() =>
        repo.insert({ ...entry, applicationId: "" })
      ).toThrow();
    });
  });

  describe("findByName", () => {
    it("finds a bot by name case-insensitively", async () => {
      repo.insert(entry);

      const found = await repo.findByName("LISA");
      expect(found?.applicationId).toBe(entry.applicationId);
    });

    it("returns null when not found", async () => {
      expect(await repo.findByName("nope")).toBeNull();
    });
  });

  describe("updateToken", () => {
    it("updates the token in place", async () => {
      repo.insert(entry);
      repo.updateToken(entry.applicationId, "rotated-token");

      const found = await repo.findByApplicationId(entry.applicationId);
      expect(found?.discordToken).toBe("rotated-token");
    });
  });

  describe("delete", () => {
    it("removes the row", async () => {
      repo.insert(entry);
      repo.delete(entry.applicationId);

      expect(await repo.findByApplicationId(entry.applicationId)).toBeNull();
      expect(await repo.count()).toBe(0);
    });
  });

  describe("seed marker", () => {
    it("isSeeded is false with no bots rows and no marker", async () => {
      expect(await repo.isSeeded()).toBe(false);
    });

    it("markSeeded persists independent of `bots` row count", async () => {
      repo.insert(entry);
      repo.markSeeded();
      repo.delete(entry.applicationId);

      // Removing every bot row must NOT make the next boot look unseeded.
      expect(await repo.count()).toBe(0);
      expect(await repo.isSeeded()).toBe(true);
    });

    it("markSeeded is idempotent (does not throw on a second call)", () => {
      repo.markSeeded();
      expect(() => repo.markSeeded()).not.toThrow();
    });
  });
});
