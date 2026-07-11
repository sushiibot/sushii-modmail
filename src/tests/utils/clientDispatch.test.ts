import { describe, it, expect } from "bun:test";
import { EventEmitter } from "events";
import type { Client } from "discord.js";
import { wrapClientDispatch } from "../../utils/clientDispatch";
import { getCurrentBot } from "../../utils/botContext";

describe("wrapClientDispatch", () => {
  it("runs handlers inside runWithBot so getCurrentBot() reflects the dispatching bot", async () => {
    const client = new EventEmitter() as unknown as Client;
    wrapClientDispatch(client, "lisa");

    let observed: string | undefined;
    client.on("test-event" as never, (() => {
      observed = getCurrentBot();
    }) as never);

    (client as unknown as EventEmitter).emit("test-event");

    expect(observed).toBe("lisa");
  });

  it("does not leak bot context across interleaved async handlers from different bots", async () => {
    const clientA = new EventEmitter() as unknown as Client;
    const clientB = new EventEmitter() as unknown as Client;
    wrapClientDispatch(clientA, "lisa");
    wrapClientDispatch(clientB, "bp");

    const observedA: (string | undefined)[] = [];
    const observedB: (string | undefined)[] = [];

    clientA.on("test-event" as never, (async () => {
      observedA.push(getCurrentBot());
      // Yield to the event loop so clientB's handler can interleave
      await new Promise((resolve) => setTimeout(resolve, 10));
      observedA.push(getCurrentBot());
    }) as never);

    clientB.on("test-event" as never, (async () => {
      observedB.push(getCurrentBot());
      await new Promise((resolve) => setTimeout(resolve, 5));
      observedB.push(getCurrentBot());
    }) as never);

    (clientA as unknown as EventEmitter).emit("test-event");
    (clientB as unknown as EventEmitter).emit("test-event");

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(observedA).toEqual(["lisa", "lisa"]);
    expect(observedB).toEqual(["bp", "bp"]);
  });
});
