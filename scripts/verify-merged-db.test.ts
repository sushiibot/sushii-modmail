import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "../src/database/db";
import { threads, snippets, runtimeConfig, botEmojis } from "../src/database/schema";
import { mergeBotDbs } from "./merge-bot-dbs";
import { verifyMergedDb } from "./verify-merged-db";

describe("verify-merged-db", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-merged-db-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSourceDb(fileName: string, guildId: string) {
    const dbPath = path.join(tmpDir, fileName);
    const db = getDb(dbPath);

    db.insert(threads)
      .values({ guildId, threadId: `${guildId}1`, recipientId: `${guildId}2` })
      .run();
    db.insert(snippets).values({ guildId, name: "hello", content: "world" }).run();
    db.insert(runtimeConfig).values({ guildId, requiredRoleIds: "[]" }).run();
    db.insert(botEmojis)
      .values({ name: "delete", id: `${guildId}emoji`, sha256: "abc" })
      .run();

    return dbPath;
  }

  function mergeSources(sources: { path: string; applicationId: string }[]) {
    const output = path.join(tmpDir, "merged.sqlite");
    mergeBotDbs({ sources, output });
    return output;
  }

  it("reports ok=true with matching row counts and correct backfill on a clean merge", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111");
    const source2 = makeSourceDb("bp.sqlite", "222");
    const sources = [
      { path: source1, applicationId: "app-lisa" },
      { path: source2, applicationId: "app-bp" },
    ];
    const merged = mergeSources(sources);

    const result = verifyMergedDb({ sources, merged });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.rowCounts.threads).toEqual({ expected: 2, actual: 2 });
  });

  it("detects a row count mismatch", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111");
    const source2 = makeSourceDb("bp.sqlite", "222");
    const sources = [
      { path: source1, applicationId: "app-lisa" },
      { path: source2, applicationId: "app-bp" },
    ];
    const merged = mergeSources(sources);

    // Corrupt the merged output: delete a thread row so it no longer
    // matches the sum of sources.
    const mergedDb = new Database(merged);
    mergedDb.run("DELETE FROM threads WHERE guild_id = ?", ["111"]);
    mergedDb.close();

    const result = verifyMergedDb({ sources, merged });

    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.check === "row_count" && f.detail.includes("threads")
      )
    ).toBe(true);
  });

  it("detects missing/incorrect applicationId backfill", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111");
    const source2 = makeSourceDb("bp.sqlite", "222");
    const sources = [
      { path: source1, applicationId: "app-lisa" },
      { path: source2, applicationId: "app-bp" },
    ];
    const merged = mergeSources(sources);

    // Corrupt the backfill: wipe applicationId on the merged config row.
    const mergedDb = new Database(merged);
    mergedDb.run("UPDATE config SET application_id = NULL WHERE guild_id = ?", [
      "111",
    ]);
    mergedDb.close();

    const result = verifyMergedDb({ sources, merged });

    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.check === "config_backfill")
    ).toBe(true);
  });

  it("flags a mismatch when the verify args claim a different applicationId than what was actually merged", () => {
    // Guards against operator error: passing verify-merged-db.ts the
    // wrong (source, applicationId) pairing for a guildId it actually
    // owns should be caught as a backfill mismatch, not silently pass.
    const source1 = makeSourceDb("lisa.sqlite", "111");
    const merged = mergeSources([{ path: source1, applicationId: "app-lisa" }]);

    const result = verifyMergedDb({
      sources: [{ path: source1, applicationId: "app-wrong" }],
      merged,
    });

    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.check === "config_backfill")
    ).toBe(true);
  });
});
