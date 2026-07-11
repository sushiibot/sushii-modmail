import { describe, it, expect } from "bun:test";
import { EnvBotRegistry } from "../../config/botRegistry";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("EnvBotRegistry", () => {
  describe("numbered roster", () => {
    it("loads a single-entry numbered roster", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "client1",
          BOT_1_MAIL_GUILD_ID: "guild1",
        })
      );

      const roster = registry.getBotConfigs();

      expect(roster).toEqual([
        {
          name: "lisa",
          discordToken: "token1",
          discordClientId: "client1",
          mailGuildId: "guild1",
        },
      ]);
    });

    it("loads a multi-entry numbered roster, stopping at the first gap", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "client1",
          BOT_1_MAIL_GUILD_ID: "guild1",
          BOT_2_NAME: "bp",
          BOT_2_DISCORD_TOKEN: "token2",
          BOT_2_DISCORD_CLIENT_ID: "client2",
          BOT_2_MAIL_GUILD_ID: "guild2",
          // BOT_3_* intentionally absent -- BOT_4_* should be ignored
          BOT_4_NAME: "twice",
          BOT_4_DISCORD_TOKEN: "token4",
          BOT_4_DISCORD_CLIENT_ID: "client4",
          BOT_4_MAIL_GUILD_ID: "guild4",
        })
      );

      const roster = registry.getBotConfigs();

      expect(roster.length).toBe(2);
      expect(roster.map((e) => e.name)).toEqual(["lisa", "bp"]);
    });

    it("throws when a numbered entry is incomplete", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          // missing BOT_1_DISCORD_CLIENT_ID
          BOT_1_MAIL_GUILD_ID: "guild1",
        })
      );

      expect(() => registry.getBotConfigs()).toThrow();
    });
  });

  describe("legacy fallback", () => {
    it("falls back to legacy env vars when no BOT_1_NAME is set", () => {
      const registry = new EnvBotRegistry(
        env({
          DISCORD_TOKEN: "legacy-token",
          DISCORD_CLIENT_ID: "legacy-client",
          MAIL_GUILD_ID: "legacy-guild",
        })
      );

      const roster = registry.getBotConfigs();

      expect(roster).toEqual([
        {
          name: "default",
          discordToken: "legacy-token",
          discordClientId: "legacy-client",
          mailGuildId: "legacy-guild",
        },
      ]);
    });

    it("throws when neither the numbered format nor legacy vars are present", () => {
      const registry = new EnvBotRegistry(env({}));

      expect(() => registry.getBotConfigs()).toThrow();
    });

    it("uses the numbered format and ignores legacy vars when both are present", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "client1",
          BOT_1_MAIL_GUILD_ID: "guild1",
          DISCORD_TOKEN: "legacy-token",
          DISCORD_CLIENT_ID: "legacy-client",
          MAIL_GUILD_ID: "legacy-guild",
        })
      );

      const roster = registry.getBotConfigs();

      expect(roster.length).toBe(1);
      expect(roster[0].name).toBe("lisa");
    });
  });

  describe("validation", () => {
    it("throws on duplicate mailGuildId", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "client1",
          BOT_1_MAIL_GUILD_ID: "same-guild",
          BOT_2_NAME: "bp",
          BOT_2_DISCORD_TOKEN: "token2",
          BOT_2_DISCORD_CLIENT_ID: "client2",
          BOT_2_MAIL_GUILD_ID: "same-guild",
        })
      );

      expect(() => registry.getBotConfigs()).toThrow(/mailGuildId/);
    });

    it("throws on duplicate name", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "same-name",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "client1",
          BOT_1_MAIL_GUILD_ID: "guild1",
          BOT_2_NAME: "same-name",
          BOT_2_DISCORD_TOKEN: "token2",
          BOT_2_DISCORD_CLIENT_ID: "client2",
          BOT_2_MAIL_GUILD_ID: "guild2",
        })
      );

      expect(() => registry.getBotConfigs()).toThrow(/name/);
    });

    it("throws on duplicate discordClientId", () => {
      const registry = new EnvBotRegistry(
        env({
          BOT_1_NAME: "lisa",
          BOT_1_DISCORD_TOKEN: "token1",
          BOT_1_DISCORD_CLIENT_ID: "same-client",
          BOT_1_MAIL_GUILD_ID: "guild1",
          BOT_2_NAME: "bp",
          BOT_2_DISCORD_TOKEN: "token2",
          BOT_2_DISCORD_CLIENT_ID: "same-client",
          BOT_2_MAIL_GUILD_ID: "guild2",
        })
      );

      expect(() => registry.getBotConfigs()).toThrow(/discordClientId/);
    });
  });
});
