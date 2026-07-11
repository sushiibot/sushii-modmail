import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Status } from "discord.js";
import {
  HealthcheckService,
  type BotInstance,
} from "../../services/HealthcheckService";

function mockClient(opts: { ready: boolean; wsStatus?: Status }) {
  return {
    isReady: () => opts.ready,
    uptime: 1000,
    ws: { ping: 10, status: opts.wsStatus ?? Status.Ready },
  } as any;
}

describe("HealthcheckService", () => {
  const port = 18080 + Math.floor(Math.random() * 1000);
  let service: HealthcheckService;

  afterEach(() => {
    service?.stop();
  });

  it("/live returns 200 even when a bot is disconnected", async () => {
    const bots: BotInstance[] = [
      { name: "lisa", client: mockClient({ ready: true }) },
      {
        name: "bp",
        client: mockClient({ ready: false, wsStatus: Status.Disconnected }),
      },
    ];
    service = new HealthcheckService(bots, port);
    service.start();

    const res = await fetch(`http://localhost:${port}/live`);
    expect(res.status).toBe(200);
  });

  it("/ready reports 200 when all bots are ready", async () => {
    const bots: BotInstance[] = [
      { name: "lisa", client: mockClient({ ready: true }) },
      { name: "bp", client: mockClient({ ready: true }) },
    ];
    service = new HealthcheckService(bots, port + 1);
    service.start();

    const res = await fetch(`http://localhost:${port + 1}/ready`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.bots.length).toBe(2);
    expect(body.bots.every((b: any) => b.ready)).toBe(true);
  });

  it("/ready reports 503 with per-bot status when one bot is disconnected", async () => {
    const bots: BotInstance[] = [
      { name: "lisa", client: mockClient({ ready: true }) },
      {
        name: "bp",
        client: mockClient({ ready: false, wsStatus: Status.Disconnected }),
      },
    ];
    service = new HealthcheckService(bots, port + 2);
    service.start();

    const res = await fetch(`http://localhost:${port + 2}/ready`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.bots.find((b: any) => b.name === "lisa").ready).toBe(true);
    expect(body.bots.find((b: any) => b.name === "bp").ready).toBe(false);
  });

  it("/health aggregates status across all bots", async () => {
    const bots: BotInstance[] = [
      { name: "lisa", client: mockClient({ ready: true }) },
      { name: "bp", client: mockClient({ ready: true }) },
      { name: "twice", client: mockClient({ ready: true }) },
    ];
    service = new HealthcheckService(bots, port + 3);
    service.start();

    const res = await fetch(`http://localhost:${port + 3}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bots.length).toBe(3);
  });
});
