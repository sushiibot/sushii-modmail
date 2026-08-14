// Leaf module (no internal imports) so botFactory.ts can register a bot's
// ThreadRepository without importing utils/metrics -- metrics.ts imports
// services/BotManager (for BotSummary), and BotManager.ts imports
// botFactory.ts, so botFactory -> utils/metrics would close an import cycle.

export interface ThreadCounter {
  countOpenThreads(): Promise<number>;
}

// Each bot owns its own ThreadRepository (scoped to its own mailGuildId), so
// this is keyed by bot name rather than a single shared repository. Re-adding
// the same name (bot reload/rotate) overwrites the old entry. A removed bot
// is left in this map -- callers must filter against the live bot roster
// (e.g. BotManager.getSummaries()) rather than trusting every key here is
// still running.
const threadRepositoriesByBot = new Map<string, ThreadCounter>();

export function registerBotThreadRepository(
  botName: string,
  repo: ThreadCounter
): void {
  threadRepositoriesByBot.set(botName, repo);
}

export function getRegisteredThreadRepository(
  botName: string
): ThreadCounter | undefined {
  return threadRepositoriesByBot.get(botName);
}
