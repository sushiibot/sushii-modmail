#!/usr/bin/env bun
/**
 * Programmatically verifies a merge-bot-dbs.ts output file against its
 * sources: row counts, applicationId backfill correctness, and no
 * cross-applicationId guildId collisions. Exits non-zero with a
 * machine-readable failure summary on any mismatch -- this is the
 * contract external tooling (the sushii-ansible migration role) gates
 * cutover on.
 *
 * Usage:
 *   bun run scripts/verify-merged-db.ts \
 *     --source /path/to/lisa.sqlite:APPLICATION_ID_LISA \
 *     --source /path/to/bp.sqlite:APPLICATION_ID_BP \
 *     --merged /path/to/merged.sqlite
 */
import { Database } from "bun:sqlite";
import type { MergeSource } from "./merge-bot-dbs";
import { parseSourceArgs } from "./scriptArgs";

const ROW_COUNT_TABLES = [
  "threads",
  "messages",
  "message_versions",
  "additional_message_ids",
  "snippets",
  "config",
  "bot_emojis",
] as const;

export interface VerifyOptions {
  sources: MergeSource[];
  merged: string;
}

export interface VerifyFailure {
  check: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checkedAt: string;
  rowCounts: Record<string, { expected: number; actual: number }>;
  failures: VerifyFailure[];
}

function countRows(db: Database, table: string): number {
  const row = db
    .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`)
    .get();
  return row?.count ?? 0;
}

export function verifyMergedDb(options: VerifyOptions): VerifyResult {
  const failures: VerifyFailure[] = [];
  const rowCounts: VerifyResult["rowCounts"] = {};

  const sourceDbs = options.sources.map((s) => ({
    source: s,
    db: new Database(s.path, { readonly: true }),
  }));
  const merged = new Database(options.merged, { readonly: true });

  try {
    // 1. Row counts per table match the sum of the sources.
    for (const table of ROW_COUNT_TABLES) {
      const expected = sourceDbs.reduce(
        (sum, { db }) => sum + countRows(db, table),
        0
      );
      const actual = countRows(merged, table);

      rowCounts[table] = { expected, actual };

      if (expected !== actual) {
        failures.push({
          check: "row_count",
          detail: `table "${table}": expected ${expected} rows (sum of sources), got ${actual}`,
        });
      }
    }

    // 2. applicationId backfill correctness on config (runtimeConfig).
    for (const { source, db } of sourceDbs) {
      const guildIds = db
        .query<{ guild_id: string }, []>("SELECT guild_id FROM config")
        .all()
        .map((r) => r.guild_id);

      for (const guildId of guildIds) {
        const row = merged
          .query<{ application_id: string | null }, [string]>(
            "SELECT application_id FROM config WHERE guild_id = ?"
          )
          .get(guildId);

        if (!row) {
          failures.push({
            check: "config_backfill",
            detail: `guildId "${guildId}" from source "${source.path}" is missing from merged config`,
          });
        } else if (row.application_id !== source.applicationId) {
          failures.push({
            check: "config_backfill",
            detail: `guildId "${guildId}": expected applicationId "${source.applicationId}", got "${row.application_id}"`,
          });
        }
      }
    }

    // 2b. applicationId backfill correctness on bot_emojis.
    for (const { source, db } of sourceDbs) {
      const ids = db
        .query<{ id: string }, []>("SELECT id FROM bot_emojis")
        .all()
        .map((r) => r.id);

      for (const id of ids) {
        const row = merged
          .query<{ application_id: string | null }, [string]>(
            "SELECT application_id FROM bot_emojis WHERE id = ?"
          )
          .get(id);

        if (!row) {
          failures.push({
            check: "bot_emojis_backfill",
            detail: `emoji id "${id}" from source "${source.path}" is missing from merged bot_emojis`,
          });
        } else if (row.application_id !== source.applicationId) {
          failures.push({
            check: "bot_emojis_backfill",
            detail: `emoji id "${id}": expected applicationId "${source.applicationId}", got "${row.application_id}"`,
          });
        }
      }
    }

    // Note: a guildId claimed by two different applicationIds in the
    // merged config is structurally impossible to check for here --
    // config.guild_id is the table's primary key, so the merged table can
    // only ever hold one row (and therefore one applicationId) per
    // guildId. That invariant is enforced by merge-bot-dbs.ts's
    // findGuildConflict pre-check (aborting the merge before any output
    // is written) and by the schema itself, not by a post-hoc scan here.
  } finally {
    for (const { db } of sourceDbs) {
      db.close();
    }
    merged.close();
  }

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    rowCounts,
    failures,
  };
}

function parseArgs(argv: string[]): VerifyOptions {
  const { sources, rest } = parseSourceArgs(argv);

  let merged: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];

    if (arg === "--merged") {
      merged = rest[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!merged) {
    throw new Error("--merged is required");
  }

  return { sources, merged };
}

if (import.meta.main) {
  // Always emit a JSON summary, even on argument or file-access errors --
  // this is the contract external tooling (the sushii-ansible migration
  // role) gates cutover on, and it must never see a bare stack trace
  // instead of parseable output.
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = verifyMergedDb(options);

    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exit(1);
    }
  } catch (err) {
    const failure: VerifyResult = {
      ok: false,
      checkedAt: new Date().toISOString(),
      rowCounts: {},
      failures: [
        {
          check: "verify_error",
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
    };
    console.log(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
}
