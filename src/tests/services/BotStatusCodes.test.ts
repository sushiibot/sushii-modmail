import { describe, it, expect } from "bun:test";
import { Status } from "discord.js";
import {
  BOT_STATUS_CODES,
  FAILED_GATEWAY_STATUS_SENTINEL,
  type BotSummary,
} from "../../services/BotManager";
import { HealthcheckService } from "../../services/HealthcheckService";

const ALL_STATUSES: BotSummary["status"][] = [
  "connected",
  "connecting",
  "disconnected",
  "failed",
];

function makeSummary(status: BotSummary["status"]): BotSummary {
  return {
    name: "lisa",
    mailGuildId: "123456789",
    applicationId: "987654321",
    status,
    ping: status === "failed" ? null : 10,
  };
}

describe("BOT_STATUS_CODES -- single source of truth for status mapping", () => {
  it("has an entry for every BotSummary status", () => {
    for (const status of ALL_STATUSES) {
      expect(BOT_STATUS_CODES[status]).toBeDefined();
    }
  });

  it("maps gateway codes to the matching discord.js Status (or the failed sentinel)", () => {
    expect(BOT_STATUS_CODES.connected.gatewayStatus).toBe(Status.Ready);
    expect(BOT_STATUS_CODES.connecting.gatewayStatus).toBe(Status.Connecting);
    expect(BOT_STATUS_CODES.disconnected.gatewayStatus).toBe(
      Status.Disconnected
    );
    expect(BOT_STATUS_CODES.failed.gatewayStatus).toBe(
      FAILED_GATEWAY_STATUS_SENTINEL
    );
  });

  it("HealthcheckService's per-bot status is driven by this same table, not a parallel switch", async () => {
    const port = 18990 + Math.floor(Math.random() * 500);
    const summaries = ALL_STATUSES.map(makeSummary);
    const service = new HealthcheckService(
      { getSummaries: () => summaries },
      port
    );
    service.start();

    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const body = await res.json();

      for (const s of ALL_STATUSES) {
        const reported = body.bots.find(
          (b: any, i: number) => summaries[i].status === s
        );
        expect(reported.status).toBe(BOT_STATUS_CODES[s].health);
      }
    } finally {
      service.stop();
    }
  });
});
