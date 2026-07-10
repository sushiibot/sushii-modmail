import { describe, it, expect, beforeEach } from "bun:test";
import { getDb } from "../../database/db";
import { BotEmojiRepository } from "../../repositories/botEmoji.repository";
import { botEmojis } from "../../database/schema";

describe("BotEmojiRepository", () => {
  let db: ReturnType<typeof getDb>;
  let repo: BotEmojiRepository;
  const appId = "app-1";

  beforeEach(() => {
    db = getDb(":memory:");
    repo = new BotEmojiRepository(db, appId);
  });

  describe("saveEmoji / getEmoji", () => {
    it("saves and retrieves an emoji scoped to its applicationId", async () => {
      await repo.saveEmoji("delete", "111", "sha1");

      const result = await repo.getEmoji("delete");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("111");
    });

    it("does not return another application's emoji with the same name", async () => {
      const otherRepo = new BotEmojiRepository(db, "app-2");
      await otherRepo.saveEmoji("delete", "222", "sha2");

      const result = await repo.getEmoji("delete");
      expect(result).toBeNull();
    });

    it("allows two different applications to register an emoji with the same name", async () => {
      const otherRepo = new BotEmojiRepository(db, "app-2");

      await repo.saveEmoji("delete", "111", "sha1");
      await otherRepo.saveEmoji("delete", "222", "sha2");

      const mine = await repo.getEmoji("delete");
      const theirs = await otherRepo.getEmoji("delete");

      expect(mine!.id).toBe("111");
      expect(theirs!.id).toBe("222");
    });
  });

  describe("legacy row migration path", () => {
    it("claims a NULL-owner legacy row in place rather than throwing a unique-constraint error", async () => {
      // Seed a legacy row directly (applicationId: NULL), simulating a
      // pre-multi-bot deployment's botEmojis row.
      await db.insert(botEmojis).values({
        name: "delete",
        id: "999",
        sha256: "legacy-sha",
      });

      // saveEmoji with the same id and a real applicationId should update
      // in place (claim the row), not throw.
      const result = await repo.saveEmoji("delete", "999", "new-sha");

      expect(result.id).toBe("999");
      expect(result.name).toBe("delete");

      // Row is now claimed and visible via the scoped getter.
      const fetched = await repo.getEmoji("delete");
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe("999");
    });
  });

  describe("content-change (new id, same name) migration path", () => {
    it("clears the stale row so the new id can be saved without a unique-constraint error", async () => {
      // Simulates editEmoji: old Discord emoji deleted, new one uploaded
      // under a brand-new id, same name/applicationId.
      await repo.saveEmoji("delete", "111", "old-sha");

      const result = await repo.saveEmoji("delete", "222", "new-sha");

      expect(result.id).toBe("222");

      // Old row is gone, new row is the only one under this name.
      const fetched = await repo.getEmoji("delete");
      expect(fetched!.id).toBe("222");

      const all = await repo.getEmojis(["delete"]);
      expect(all.length).toBe(1);
    });
  });

  describe("composite index data integrity", () => {
    it("rejects two different ids claiming the same name under the same applicationId", async () => {
      await repo.saveEmoji("delete", "111", "sha1");

      expect(
        db
          .insert(botEmojis)
          .values({
            name: "delete",
            id: "222",
            sha256: "sha2",
            applicationId: appId,
          })
          .execute()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });
  });

  describe("getEmojis / getEmojiMap", () => {
    it("only returns emojis scoped to this application", async () => {
      const otherRepo = new BotEmojiRepository(db, "app-2");

      await repo.saveEmoji("delete", "111", "sha1");
      await repo.saveEmoji("edit", "222", "sha2");
      await otherRepo.saveEmoji("delete", "333", "sha3");

      const results = await repo.getEmojis(["delete", "edit"]);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id).sort()).toEqual(["111", "222"]);
    });
  });
});
