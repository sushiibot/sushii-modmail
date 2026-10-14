import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knownSecretValues,
  loadSecrets,
  registerEnvRosterTokens,
  requireSecret,
} from "../../config/secrets";
import { EnvBotRegistry } from "../../config/botRegistry";

describe("loadSecrets", () => {
  test("NAME_FILE is read when set, trailing newline trimmed", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-"));
    try {
      const file = join(dir, "discord");
      writeFileSync(file, "from-file-token\n");
      expect(loadSecrets({ DISCORD_TOKEN_FILE: file }).DISCORD_TOKEN).toBe(
        "from-file-token"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable NAME_FILE names the variable and the error code only", () => {
    expect(() =>
      loadSecrets({ LITESTREAM_SECRET_ACCESS_KEY_FILE: "/nonexistent/key" })
    ).toThrow("LITESTREAM_SECRET_ACCESS_KEY_FILE could not be read (ENOENT)");
  });

  test("an empty secret counts as unset, and the result is frozen", () => {
    const loaded = loadSecrets({
      LITESTREAM_ACCESS_KEY_ID: "id",
      LITESTREAM_SECRET_ACCESS_KEY: "",
    });
    expect(loaded.LITESTREAM_SECRET_ACCESS_KEY).toBeUndefined();
    expect(Object.isFrozen(loaded)).toBe(true);
  });
});

test("requireSecret names a missing variable without a value", () => {
  let message = "";
  try {
    requireSecret(
      "DISCORD_TOKEN",
      loadSecrets({ LITESTREAM_ACCESS_KEY_ID: "litestream-id-should-not-appear" })
    );
  } catch (e) {
    message = String(e);
  }
  expect(message).toContain("Missing required secrets: DISCORD_TOKEN");
  expect(message).not.toContain("litestream-id-should-not-appear");
});

describe("roster tokens", () => {
  test("BOT_N_DISCORD_TOKEN values in env, including _FILE, are registered for scrubbing", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-"));
    try {
      const file = join(dir, "bot2");
      writeFileSync(file, "roster-file-token-222\n");
      registerEnvRosterTokens({
        BOT_1_DISCORD_TOKEN: "roster-env-token-111",
        BOT_2_DISCORD_TOKEN_FILE: file,
        BOT_3_DISCORD_TOKEN_FILE: "/nonexistent/bot3",
      });
      expect(knownSecretValues()).toContain("roster-env-token-111");
      expect(knownSecretValues()).toContain("roster-file-token-222");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("EnvBotRegistry reads a token from BOT_N_DISCORD_TOKEN_FILE and registers it", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-"));
    try {
      const file = join(dir, "bot1");
      writeFileSync(file, "registry-file-token-333\n");
      const roster = new EnvBotRegistry({
        BOT_1_NAME: "lisa",
        BOT_1_DISCORD_TOKEN_FILE: file,
        BOT_1_MAIL_GUILD_ID: "guild1",
      }).getBotConfigs();
      expect(roster[0]?.discordToken).toBe("registry-file-token-333");
      expect(knownSecretValues()).toContain("registry-file-token-333");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an invalid roster entry names fields and codes, never the token", () => {
    let message = "";
    try {
      new EnvBotRegistry({
        BOT_1_NAME: "lisa",
        BOT_1_DISCORD_TOKEN: "invalid-entry-token-444",
      }).getBotConfigs();
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("mailGuildId (invalid_type)");
    expect(message).not.toContain("invalid-entry-token-444");
  });
});
