import { describe, it, expect, beforeEach } from "bun:test";
import { getDb } from "../../database/db";
import { RuntimeConfigRepository } from "../../repositories/runtimeConfig.repository";
import { GuildOwnershipConflictError } from "../../repositories/errors";
import { runtimeConfig } from "../../database/schema";

describe("RuntimeConfigRepository", () => {
  let db: ReturnType<typeof getDb>;
  let repo: RuntimeConfigRepository;
  const appId = "app-1";
  const guildId = "123456789";

  beforeEach(() => {
    db = getDb(":memory:");
    repo = new RuntimeConfigRepository(db, appId);
  });

  describe("getConfig", () => {
    it("returns the in-memory default with no throw when no row exists", async () => {
      const result = await repo.getConfig(guildId);
      expect(result.guildId).toBe(guildId);
    });

    it("does not throw when the row's applicationId is NULL (legacy row)", async () => {
      await db.insert(runtimeConfig).values({
        guildId,
        requiredRoleIds: "[]",
      });

      const result = await repo.getConfig(guildId);
      expect(result.guildId).toBe(guildId);
    });

    it("does not throw when the row's applicationId matches", async () => {
      await repo.setConfig(guildId, {});

      const result = await repo.getConfig(guildId);
      expect(result.guildId).toBe(guildId);
    });

    it("throws GuildOwnershipConflictError when the row belongs to a different applicationId", async () => {
      const otherRepo = new RuntimeConfigRepository(db, "app-2");
      await otherRepo.setConfig(guildId, {});

      expect(repo.getConfig(guildId)).rejects.toThrow(
        GuildOwnershipConflictError
      );
    });
  });

  describe("setConfig", () => {
    it("claims an unclaimed (NULL applicationId) row on write", async () => {
      await db.insert(runtimeConfig).values({
        guildId,
        requiredRoleIds: "[]",
      });

      await repo.setConfig(guildId, { prefix: "!" });

      const row = await repo.getConfig(guildId);
      expect(row.prefix).toBe("!");
    });

    it("throws GuildOwnershipConflictError without writing when the row belongs to a different applicationId", async () => {
      const otherRepo = new RuntimeConfigRepository(db, "app-2");
      await otherRepo.setConfig(guildId, { prefix: "other" });

      expect(repo.setConfig(guildId, { prefix: "mine" })).rejects.toThrow(
        GuildOwnershipConflictError
      );

      // Confirm no write happened -- other bot's config unchanged.
      const result = await otherRepo.getConfig(guildId);
      expect(result.prefix).toBe("other");
    });
  });

  describe("toggleAnonymousSnippets", () => {
    it("throws GuildOwnershipConflictError without writing when the row belongs to a different applicationId", async () => {
      const otherRepo = new RuntimeConfigRepository(db, "app-2");
      await otherRepo.setConfig(guildId, {});

      expect(repo.toggleAnonymousSnippets(guildId)).rejects.toThrow(
        GuildOwnershipConflictError
      );
    });
  });
});
