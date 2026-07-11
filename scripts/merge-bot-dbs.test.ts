import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "../src/database/db";
import { threads, snippets, runtimeConfig, botEmojis } from "../src/database/schema";
import {
  mergeBotDbs,
  findGuildConflict,
  GuildConflictError,
} from "./merge-bot-dbs";

describe("merge-bot-dbs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-bot-dbs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSourceDb(fileName: string, guildId: string, appId: string) {
    const dbPath = path.join(tmpDir, fileName);
    const db = getDb(dbPath);

    db.insert(threads)
      .values({
        guildId,
        threadId: `${guildId}1`,
        recipientId: `${guildId}2`,
      })
      .run();

    db.insert(snippets)
      .values({ guildId, name: "hello", content: "world" })
      .run();

    db.insert(runtimeConfig)
      .values({ guildId, requiredRoleIds: "[]" })
      .run();

    db.insert(botEmojis)
      .values({ name: "delete", id: `${guildId}emoji`, sha256: "abc" })
      .run();

    return dbPath;
  }

  it("merges two non-conflicting source DBs", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111", "app-lisa");
    const source2 = makeSourceDb("bp.sqlite", "222", "app-bp");
    const output = path.join(tmpDir, "merged.sqlite");

    mergeBotDbs({
      sources: [
        { path: source1, applicationId: "app-lisa" },
        { path: source2, applicationId: "app-bp" },
      ],
      output,
    });

    expect(fs.existsSync(output)).toBe(true);

    const merged = new Database(output, { readonly: true });
    const threadRows = merged.query("SELECT * FROM threads").all();
    const configRows = merged
      .query<{ guild_id: string; application_id: string }, []>(
        "SELECT guild_id, application_id FROM config ORDER BY guild_id"
      )
      .all();
    const emojiRows = merged
      .query<{ application_id: string }, []>(
        "SELECT application_id FROM bot_emojis ORDER BY application_id"
      )
      .all();

    expect(threadRows.length).toBe(2);
    expect(configRows).toEqual([
      { guild_id: "111", application_id: "app-lisa" },
      { guild_id: "222", application_id: "app-bp" },
    ]);
    expect(emojiRows.map((r) => r.application_id).sort()).toEqual([
      "app-bp",
      "app-lisa",
    ]);

    merged.close();
  });

  it("merges three sources in one shot", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111", "app-lisa");
    const source2 = makeSourceDb("bp.sqlite", "222", "app-bp");
    const source3 = makeSourceDb("twice.sqlite", "333", "app-twice");
    const output = path.join(tmpDir, "merged.sqlite");

    mergeBotDbs({
      sources: [
        { path: source1, applicationId: "app-lisa" },
        { path: source2, applicationId: "app-bp" },
        { path: source3, applicationId: "app-twice" },
      ],
      output,
    });

    const merged = new Database(output, { readonly: true });
    const threadCount = merged
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM threads")
      .get();

    expect(threadCount?.count).toBe(3);
    merged.close();
  });

  it("aborts with no output file written when a guildId conflicts across sources", () => {
    const source1 = makeSourceDb("lisa.sqlite", "999", "app-lisa");
    const source2 = makeSourceDb("bp.sqlite", "999", "app-bp");
    const output = path.join(tmpDir, "merged.sqlite");

    expect(() =>
      mergeBotDbs({
        sources: [
          { path: source1, applicationId: "app-lisa" },
          { path: source2, applicationId: "app-bp" },
        ],
        output,
      })
    ).toThrow(GuildConflictError);

    expect(fs.existsSync(output)).toBe(false);
  });

  it("removes the partially-written output file when a source fails mid-merge", () => {
    // guildIds don't conflict (passes findGuildConflict's pre-check), but
    // both sources share a bot_emojis.id -- a collision only the second
    // source's INSERT surfaces, after the first source's rows are already
    // written to the output file.
    const source1 = makeSourceDb("lisa.sqlite", "111", "app-lisa");
    const source2Path = path.join(tmpDir, "bp.sqlite");
    const source2 = getDb(source2Path);
    source2
      .insert(threads)
      .values({ guildId: "222", threadId: "2221", recipientId: "2222" })
      .run();
    source2
      .insert(botEmojis)
      .values({
        name: "delete",
        // Same id as source1's emoji row -- collides on the output's
        // bot_emojis primary key once both sources are merged.
        id: "111emoji",
        sha256: "abc",
      })
      .run();

    const output = path.join(tmpDir, "merged.sqlite");

    expect(() =>
      mergeBotDbs({
        sources: [
          { path: source1, applicationId: "app-lisa" },
          { path: source2Path, applicationId: "app-bp" },
        ],
        output,
      })
    ).toThrow();

    expect(fs.existsSync(output)).toBe(false);
    expect(fs.existsSync(`${output}-journal`)).toBe(false);
  });

  it("findGuildConflict detects the conflicting guildId and both source paths", () => {
    const source1 = makeSourceDb("lisa.sqlite", "555", "app-lisa");
    const source2 = makeSourceDb("bp.sqlite", "555", "app-bp");

    const conflict = findGuildConflict([
      { path: source1, applicationId: "app-lisa" },
      { path: source2, applicationId: "app-bp" },
    ]);

    expect(conflict).not.toBeNull();
    expect(conflict!.guildId).toBe("555");
  });

  it("never writes to source files", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111", "app-lisa");
    const source2 = makeSourceDb("bp.sqlite", "222", "app-bp");
    const output = path.join(tmpDir, "merged.sqlite");

    const beforeStat1 = fs.statSync(source1);
    const beforeStat2 = fs.statSync(source2);
    const beforeContent1 = fs.readFileSync(source1);
    const beforeContent2 = fs.readFileSync(source2);

    mergeBotDbs({
      sources: [
        { path: source1, applicationId: "app-lisa" },
        { path: source2, applicationId: "app-bp" },
      ],
      output,
    });

    expect(fs.readFileSync(source1).equals(beforeContent1)).toBe(true);
    expect(fs.readFileSync(source2).equals(beforeContent2)).toBe(true);
    expect(fs.statSync(source1).mtimeMs).toBe(beforeStat1.mtimeMs);
    expect(fs.statSync(source2).mtimeMs).toBe(beforeStat2.mtimeMs);
  });

  it("refuses to overwrite an existing output file without --force", () => {
    const source1 = makeSourceDb("lisa.sqlite", "111", "app-lisa");
    const output = path.join(tmpDir, "merged.sqlite");
    fs.writeFileSync(output, "existing");

    expect(() =>
      mergeBotDbs({
        sources: [{ path: source1, applicationId: "app-lisa" }],
        output,
      })
    ).toThrow(/already exists/);
  });
});
