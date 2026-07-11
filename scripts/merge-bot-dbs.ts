#!/usr/bin/env bun
/**
 * Merges N per-bot SQLite files into a single shared DB file.
 *
 * Usage:
 *   bun run scripts/merge-bot-dbs.ts \
 *     --source /path/to/lisa.sqlite:APPLICATION_ID_LISA \
 *     --source /path/to/bp.sqlite:APPLICATION_ID_BP \
 *     --source /path/to/twice.sqlite:APPLICATION_ID_TWICE \
 *     --output /path/to/merged.sqlite
 *
 * Only ever reads from source files -- never writes to them. Aborts (no
 * partial output file written) if any two sources share a guildId in
 * threads/snippets/config, since that would mean two bots already serve
 * the same guild.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import fs from "fs";
import path from "path";
import { parseSourceArgs, type SourceArg } from "./scriptArgs";

export type MergeSource = SourceArg;

export interface MergeOptions {
  sources: MergeSource[];
  output: string;
  force?: boolean;
}

export class GuildConflictError extends Error {
  constructor(
    public readonly guildId: string,
    public readonly table: string,
    public readonly sourceA: string,
    public readonly sourceB: string
  ) {
    super(
      `guildId "${guildId}" found in table "${table}" in both ` +
        `"${sourceA}" and "${sourceB}" -- two bots already serve this ` +
        `guild, refusing to merge`
    );
    this.name = "GuildConflictError";
  }
}

const GUILD_SCOPED_TABLES = ["threads", "snippets", "config"] as const;

function parseArgs(argv: string[]): MergeOptions {
  const { sources, rest } = parseSourceArgs(argv);

  let output: string | undefined;
  let force = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];

    if (arg === "--output") {
      output = rest[++i];
    } else if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!output) {
    throw new Error("--output is required");
  }

  return { sources, output, force };
}

/**
 * Checks for a guildId present in more than one source's guild-scoped
 * tables. Returns the first conflict found, or null if none.
 */
export function findGuildConflict(
  sources: MergeSource[]
): GuildConflictError | null {
  const seen = new Map<string, { sourcePath: string; table: string }>();

  for (const source of sources) {
    const db = new Database(source.path, { readonly: true });

    try {
      for (const table of GUILD_SCOPED_TABLES) {
        const rows = db
          .query<{ guild_id: string }, []>(`SELECT DISTINCT guild_id FROM ${table}`)
          .all();

        for (const row of rows) {
          const existing = seen.get(row.guild_id);
          if (existing && existing.sourcePath !== source.path) {
            return new GuildConflictError(
              row.guild_id,
              table,
              existing.sourcePath,
              source.path
            );
          }
          seen.set(row.guild_id, { sourcePath: source.path, table });
        }
      }
    } finally {
      db.close();
    }
  }

  return null;
}

function createOutputDb(outputPath: string): Database {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(outputPath);
  const db = drizzle(sqlite, { casing: "snake_case" });

  migrate(db, {
    migrationsFolder: path.join(import.meta.dir, "..", "drizzle"),
    migrationsSchema: "main",
    migrationsTable: "drizzle_migrations",
  });

  return sqlite;
}

function mergeSource(output: Database, source: MergeSource): void {
  const alias = "src";

  output.run(`ATTACH DATABASE ? AS ${alias}`, [source.path]);

  try {
    // Insert order matters for FK constraints: threads before
    // messages/message_versions/additional_message_ids.
    output.run(`
      INSERT INTO main.threads
        (guild_id, thread_id, recipient_id, title, created_at, closed_at, closed_by)
      SELECT guild_id, thread_id, recipient_id, title, created_at, closed_at, closed_by
      FROM ${alias}.threads
    `);

    output.run(`
      INSERT INTO main.messages
        (thread_id, message_id, author_id, is_staff, staff_relayed_message_id,
         user_dm_message_id, content, forwarded, attachment_urls, stickers,
         is_anonymous, is_plain_text, is_snippet, is_deleted)
      SELECT thread_id, message_id, author_id, is_staff, staff_relayed_message_id,
         user_dm_message_id, content, forwarded, attachment_urls, stickers,
         is_anonymous, is_plain_text, is_snippet, is_deleted
      FROM ${alias}.messages
    `);

    output.run(`
      INSERT INTO main.message_versions (message_id, version, content, edited_at)
      SELECT message_id, version, content, edited_at
      FROM ${alias}.message_versions
    `);

    output.run(`
      INSERT INTO main.additional_message_ids (main_message_id, additional_message_id)
      SELECT main_message_id, additional_message_id
      FROM ${alias}.additional_message_ids
    `);

    output.run(`
      INSERT INTO main.snippets (guild_id, name, content)
      SELECT guild_id, name, content
      FROM ${alias}.snippets
    `);

    // config (runtimeConfig): backfill application_id ownership from this
    // source's paired applicationId regardless of the source's own value
    // (a per-bot source DB's rows conceptually all belong to that one bot).
    output.run(
      `
      INSERT INTO main.config
        (guild_id, application_id, open_tag_id, closed_tag_id, prefix,
         forum_channel_id, logs_channel_id, required_role_ids, initial_message,
         anonymous_snippets, notification_role_id, notification_silent, bot_status)
      SELECT guild_id, ?, open_tag_id, closed_tag_id, prefix,
         forum_channel_id, logs_channel_id, required_role_ids, initial_message,
         anonymous_snippets, notification_role_id, notification_silent, bot_status
      FROM ${alias}.config
    `,
      [source.applicationId]
    );

    // botEmojis: application-scoped (not guild-scoped), backfill the same way.
    output.run(
      `
      INSERT INTO main.bot_emojis (name, id, sha256, application_id)
      SELECT name, id, sha256, ?
      FROM ${alias}.bot_emojis
    `,
      [source.applicationId]
    );
  } finally {
    output.run(`DETACH DATABASE ${alias}`);
  }
}

export function mergeBotDbs(options: MergeOptions): void {
  for (const source of options.sources) {
    if (!fs.existsSync(source.path)) {
      throw new Error(`Source file does not exist: ${source.path}`);
    }
  }

  if (fs.existsSync(options.output) && !options.force) {
    throw new Error(
      `Output file already exists: ${options.output} (use --force to overwrite)`
    );
  }

  const conflict = findGuildConflict(options.sources);
  if (conflict) {
    // Abort before creating any output file.
    throw conflict;
  }

  if (options.force && fs.existsSync(options.output)) {
    fs.unlinkSync(options.output);
  }

  const output = createOutputDb(options.output);

  try {
    for (const source of options.sources) {
      mergeSource(output, source);
    }
  } catch (err) {
    // Don't leave a half-merged file on disk if a source fails partway
    // through -- only the guildId-conflict pre-check (above) is cheap
    // enough to run before the output file exists; any other failure
    // (e.g. an unexpected constraint violation on a later source) is only
    // detectable once we're already writing, so clean up here instead.
    output.close();
    removeOutputFile(options.output);
    throw err;
  }

  output.close();
}

function removeOutputFile(outputPath: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = `${outputPath}${suffix}`;
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    mergeBotDbs(options);
    console.log(`Merged ${options.sources.length} source(s) into ${options.output}`);
  } catch (err) {
    console.error("merge-bot-dbs failed:", err);
    process.exit(1);
  }
}
