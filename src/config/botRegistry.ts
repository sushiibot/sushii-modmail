import { z } from "zod";

export interface BotRosterEntry {
  // Stable id for logs/health, e.g. "lisa"
  name: string;
  discordToken: string;
  // Discord application id
  discordClientId: string;
  mailGuildId: string;
}

export interface BotRegistry {
  getBotConfigs(): BotRosterEntry[] | Promise<BotRosterEntry[]>;
}

const rosterEntrySchema = z.object({
  name: z.string().min(1),
  discordToken: z.string().min(1),
  discordClientId: z.string().min(1),
  mailGuildId: z.string().min(1),
});

/**
 * Reads the bot roster from numbered env vars: BOT_1_NAME,
 * BOT_1_DISCORD_TOKEN, BOT_1_DISCORD_CLIENT_ID, BOT_1_MAIL_GUILD_ID,
 * BOT_2_*, etc, scanning from n = 1 until a gap. If no BOT_1_NAME is set,
 * falls back to a single implicit entry built from the legacy
 * DISCORD_TOKEN/DISCORD_CLIENT_ID/MAIL_GUILD_ID vars, so a deployment
 * that never adopts the numbered format keeps working unchanged.
 */
export class EnvBotRegistry implements BotRegistry {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getBotConfigs(): BotRosterEntry[] {
    const numbered = this.readNumberedRoster();

    const roster =
      numbered.length > 0 ? numbered : this.readLegacyFallback();

    this.validateRoster(roster);

    return roster;
  }

  private readNumberedRoster(): BotRosterEntry[] {
    const entries: BotRosterEntry[] = [];

    for (let n = 1; ; n += 1) {
      const name = this.env[`BOT_${n}_NAME`];
      if (name === undefined) {
        break;
      }

      const discordToken = this.env[`BOT_${n}_DISCORD_TOKEN`];
      const discordClientId = this.env[`BOT_${n}_DISCORD_CLIENT_ID`];
      const mailGuildId = this.env[`BOT_${n}_MAIL_GUILD_ID`];

      const parsed = rosterEntrySchema.safeParse({
        name,
        discordToken,
        discordClientId,
        mailGuildId,
      });

      if (!parsed.success) {
        throw new Error(
          `Incomplete or invalid roster entry for BOT_${n}_*: ${parsed.error}`
        );
      }

      entries.push(parsed.data);
    }

    return entries;
  }

  private readLegacyFallback(): BotRosterEntry[] {
    const discordToken = this.env.DISCORD_TOKEN;
    const discordClientId = this.env.DISCORD_CLIENT_ID;
    const mailGuildId = this.env.MAIL_GUILD_ID;

    const parsed = rosterEntrySchema.safeParse({
      name: "default",
      discordToken,
      discordClientId,
      mailGuildId,
    });

    if (!parsed.success) {
      throw new Error(
        `No BOT_1_* roster entries found and legacy DISCORD_TOKEN/` +
          `DISCORD_CLIENT_ID/MAIL_GUILD_ID vars are missing or incomplete: ${parsed.error}`
      );
    }

    return [parsed.data];
  }

  private validateRoster(roster: BotRosterEntry[]): void {
    this.assertUnique(roster, (e) => e.mailGuildId, "mailGuildId");
    this.assertUnique(roster, (e) => e.name, "name");
    this.assertUnique(roster, (e) => e.discordClientId, "discordClientId");
  }

  private assertUnique(
    roster: BotRosterEntry[],
    key: (entry: BotRosterEntry) => string,
    fieldName: string
  ): void {
    const seen = new Map<string, string>();

    for (const entry of roster) {
      const value = key(entry);
      const existing = seen.get(value);

      if (existing !== undefined) {
        throw new Error(
          `Duplicate ${fieldName} "${value}" in roster: entries "${existing}" and "${entry.name}"`
        );
      }

      seen.set(value, entry.name);
    }
  }
}
