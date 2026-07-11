import type { Client } from "discord.js";
import * as Sentry from "@sentry/bun";
import { runWithBot } from "./botContext";

/**
 * Monkey-patches client.on/client.once so every event handler registered
 * after this call runs inside runWithBot(botName, ...) and a forked
 * Sentry scope tagged with the bot name. This lets registerEventHandlers'
 * existing ~10 client.on/client.once call sites stay untouched -- the
 * wrapping happens once, here, instead of at each registration.
 */
export function wrapClientDispatch(client: Client, botName: string): void {
  const originalOn = client.on.bind(client);
  const originalOnce = client.once.bind(client);

  client.on = ((event: string, listener: (...args: unknown[]) => unknown) =>
    originalOn(event as never, wrapListener(botName, listener) as never)) as typeof client.on;

  client.once = ((
    event: string,
    listener: (...args: unknown[]) => unknown
  ) =>
    originalOnce(
      event as never,
      wrapListener(botName, listener) as never
    )) as typeof client.once;
}

function wrapListener(
  botName: string,
  listener: (...args: unknown[]) => unknown
) {
  return (...args: unknown[]) =>
    runWithBot(botName, () =>
      Sentry.withScope((scope) => {
        scope.setTag("bot", botName);
        return listener(...args);
      })
    );
}
