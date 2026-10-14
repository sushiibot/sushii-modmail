import { describe, it, expect } from "bun:test";
import { getConfigFromEnv } from "../../config/config";

const originalEnv = { ...process.env };

describe("getConfigFromEnv", () => {
  it("parses valid environment variables", () => {
    process.env = {
      LOG_LEVEL: "info",
      DISCORD_TOKEN: "token",
      DATABASE_URI: "db",
      MAIL_GUILD_ID: "guild",
    };

    const config = getConfigFromEnv();

    expect(config).not.toHaveProperty("DISCORD_TOKEN");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.HEALTHCHECK_PORT).toBe(3000);
  });

  it("throws when required variables are missing", () => {
    process.env = { ...originalEnv };
    delete process.env.DISCORD_TOKEN;
    delete process.env.DATABASE_URI;
    delete process.env.MAIL_GUILD_ID;

    expect(() => getConfigFromEnv()).toThrow();
  });

  it("names an invalid variable without echoing its value", () => {
    process.env = { DATABASE_URI: "db", HEALTHCHECK_PORT: "not-a-port-value" };

    let message = "";
    try {
      getConfigFromEnv();
    } catch (e) {
      message = String(e);
    }

    expect(message).toContain("HEALTHCHECK_PORT");
    expect(message).not.toContain("not-a-port-value");
  });
});

process.env = originalEnv;
