import {
  EnvBotRegistry,
  resolveApplicationId,
  type BotRegistry,
} from "config/botRegistry";
import type { DB } from "database/db";
import { BotRepository, type BotRosterEntry } from "repositories/bot.repository";

/**
 * Seeds the `bots` table once, from whatever EnvBotRegistry currently
 * reads, on the very first boot -- after this runs (or has already run on
 * a prior boot), env vars are never consulted for the roster again, even
 * if the numbered BOT_N_ vars or legacy DISCORD_TOKEN are still sitting in
 * `.env`. All-or-nothing: a partial failure aborts the whole seed rather
 * than silently dropping a bot forever (applicationId is the primary key
 * from here on, so a skipped entry has no later chance to be picked up
 * from env again).
 */
export async function seedIfNeeded(
  db: DB,
  botRepository: BotRepository,
  deps: {
    envRegistry?: BotRegistry;
    resolveApplicationId?: typeof resolveApplicationId;
  } = {}
): Promise<void> {
  const envRegistry = deps.envRegistry ?? new EnvBotRegistry();
  const resolveAppId = deps.resolveApplicationId ?? resolveApplicationId;

  if (await botRepository.isSeeded()) {
    return;
  }

  let envRoster;
  try {
    envRoster = await envRegistry.getBotConfigs();
  } catch (err) {
    throw new Error(
      "No bots configured: neither the `bots` table nor BOT_N_*/DISCORD_TOKEN " +
        "env vars have any entries. At least one bot must be configured via " +
        "env vars for the very first boot.",
      { cause: err }
    );
  }

  const resolvedEntries: BotRosterEntry[] = [];
  for (const entry of envRoster) {
    try {
      const applicationId = await resolveAppId(entry.discordToken);
      resolvedEntries.push({ ...entry, applicationId });
    } catch (err) {
      throw new Error(
        `First-boot seed failed: could not resolve application id for bot "${entry.name}". ` +
          `Fix the token/env config and restart before any bot can come up.`,
        { cause: err }
      );
    }
  }

  // Synchronous transaction body -- Bun's sqlite session commits as soon
  // as the callback returns, so nothing inside may await; insert()/
  // markSeeded() run synchronously under the hood regardless.
  db.transaction((tx) => {
    for (const entry of resolvedEntries) {
      botRepository.insert(entry, tx);
    }
    botRepository.markSeeded(tx);
  });
}
