import { describe, it, expect, afterEach } from "bun:test";
import { HealthcheckService } from "../../services/HealthcheckService";
import type { BotSummary } from "../../services/BotManager";

function makeSummary(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
    name: "lisa",
    mailGuildId: "123456789",
    applicationId: "987654321",
    status: "connected",
    ping: 10,
    ...overrides,
  };
}

function provider(summaries: BotSummary[]) {
  return { getSummaries: () => summaries };
}

describe("HealthcheckService", () => {
  const port = 18080 + Math.floor(Math.random() * 1000);
  let service: HealthcheckService;

  afterEach(() => {
    service?.stop();
  });

  it("/live returns 200 even when a bot is disconnected", async () => {
    const summaries = [
      makeSummary({ name: "lisa" }),
      makeSummary({ name: "bp", status: "disconnected", ping: null }),
    ];
    service = new HealthcheckService(provider(summaries), port);
    service.start();

    const res = await fetch(`http://localhost:${port}/live`);
    expect(res.status).toBe(200);
  });

  it("/ready reports 200 when all bots are ready", async () => {
    const summaries = [
      makeSummary({ name: "lisa" }),
      makeSummary({ name: "bp" }),
    ];
    service = new HealthcheckService(provider(summaries), port + 1);
    service.start();

    const res = await fetch(`http://localhost:${port + 1}/ready`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.bots.length).toBe(2);
    expect(body.bots.every((b: any) => b.ready)).toBe(true);
  });

  it("/ready reports 503 with per-bot status when one bot is disconnected", async () => {
    const summaries = [
      makeSummary({ name: "lisa" }),
      makeSummary({ name: "bp", status: "disconnected", ping: null }),
    ];
    service = new HealthcheckService(provider(summaries), port + 2);
    service.start();

    const res = await fetch(`http://localhost:${port + 2}/ready`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.bots.find((b: any) => b.name === "lisa").ready).toBe(true);
    expect(body.bots.find((b: any) => b.name === "bp").ready).toBe(false);
  });

  it("/health aggregates status across all bots", async () => {
    const summaries = [
      makeSummary({ name: "lisa" }),
      makeSummary({ name: "bp" }),
      makeSummary({ name: "twice" }),
    ];
    service = new HealthcheckService(provider(summaries), port + 3);
    service.start();

    const res = await fetch(`http://localhost:${port + 3}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bots.length).toBe(3);
  });

  it("renders a `failed` bot without touching a Client -- summary-only contract", async () => {
    const summaries = [
      makeSummary({
        name: "lisa",
        status: "failed",
        ping: null,
        lastError: "bad token",
      }),
    ];
    service = new HealthcheckService(provider(summaries), port + 4);
    service.start();

    const res = await fetch(`http://localhost:${port + 4}/health`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.bots[0].ready).toBe(false);
    expect(body.bots[0].lastError).toBe("bad token");
  });

  it("/ready reports 503 (not vacuously ready) when there are zero bots yet, e.g. mid-boot", async () => {
    service = new HealthcheckService(provider([]), port + 5);
    service.start();

    const res = await fetch(`http://localhost:${port + 5}/ready`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
  });
});
