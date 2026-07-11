import { AsyncLocalStorage } from "async_hooks";

interface BotContext {
  bot: string;
}

const storage = new AsyncLocalStorage<BotContext>();

export function runWithBot<T>(name: string, fn: () => T): T {
  return storage.run({ bot: name }, fn);
}

export function getCurrentBot(): string | undefined {
  return storage.getStore()?.bot;
}
