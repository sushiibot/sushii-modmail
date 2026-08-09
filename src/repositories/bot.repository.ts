import type { DB, DBOrTx } from "database/db";
import { bots, botRosterSeedState } from "database/schema";
import { eq, sql } from "drizzle-orm";
import { getLogger } from "utils/logger";

export interface BotRosterEntry {
  applicationId: string;
  discordToken: string;
  name: string;
  mailGuildId: string;
  createdAt?: Date;
}

/**
 * Wraps a raw SQLite unique-constraint error into a friendly message,
 * matched on the failing *column* (SQLite's own error format), not the
 * Drizzle index name -- and never includes the token itself.
 */
export class DuplicateBotFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateBotFieldError";
  }
}

function mapInsertError(err: unknown): never {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message ?? "";

  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    if (message.includes("bots.discord_token")) {
      throw new DuplicateBotFieldError(
        "This token is already registered to another bot."
      );
    }
    if (message.includes("bots.mail_guild_id")) {
      throw new DuplicateBotFieldError("This guild already has a bot.");
    }
    if (message.includes("bots.name") || message.includes("bots_name_idx")) {
      throw new DuplicateBotFieldError("This name is already in use.");
    }
    if (message.includes("bots.application_id")) {
      throw new DuplicateBotFieldError(
        "This application is already registered."
      );
    }
  }

  throw err;
}

export class BotRepository {
  private db: DB;
  private logger = getLogger(this.constructor.name);

  constructor(db: DB) {
    this.db = db;
  }

  /** Internal use only (seeding, BotManager.start) -- includes the token. */
  async list(): Promise<BotRosterEntry[]> {
    const rows = await this.db.select().from(bots).execute();
    return rows;
  }

  async findByName(name: string): Promise<BotRosterEntry | null> {
    const rows = await this.db
      .select()
      .from(bots)
      .where(sql`lower(${bots.name}) = lower(${name})`)
      .limit(1)
      .execute();

    return rows[0] ?? null;
  }

  async findByApplicationId(
    applicationId: string
  ): Promise<BotRosterEntry | null> {
    const rows = await this.db
      .select()
      .from(bots)
      .where(eq(bots.applicationId, applicationId))
      .limit(1)
      .execute();

    return rows[0] ?? null;
  }

  insert(entry: BotRosterEntry, tx: DBOrTx = this.db): void {
    try {
      tx.insert(bots)
        .values({
          applicationId: entry.applicationId,
          discordToken: entry.discordToken,
          name: entry.name,
          mailGuildId: entry.mailGuildId,
        })
        .run();
    } catch (err) {
      this.logger.error(
        { err, applicationId: entry.applicationId, name: entry.name },
        "Failed to insert bot roster entry"
      );
      mapInsertError(err);
    }
  }

  updateToken(
    applicationId: string,
    newToken: string,
    tx: DBOrTx = this.db
  ): void {
    try {
      tx.update(bots)
        .set({ discordToken: newToken })
        .where(eq(bots.applicationId, applicationId))
        .run();
    } catch (err) {
      this.logger.error(
        { err, applicationId },
        "Failed to update bot token"
      );
      mapInsertError(err);
    }
  }

  delete(applicationId: string, tx: DBOrTx = this.db): void {
    tx.delete(bots).where(eq(bots.applicationId, applicationId)).run();
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ applicationId: bots.applicationId }).from(bots).execute();
    return rows.length;
  }

  async isSeeded(): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(botRosterSeedState)
      .where(eq(botRosterSeedState.id, 1))
      .limit(1)
      .execute();

    return rows.length > 0;
  }

  markSeeded(tx: DBOrTx = this.db): void {
    tx.insert(botRosterSeedState)
      .values({ id: 1 })
      .onConflictDoNothing()
      .run();
  }
}
