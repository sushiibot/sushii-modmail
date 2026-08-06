import { describe, it, expect } from "bun:test";
import { Message, PermissionsBitField } from "discord.js";
import CommandRouter from "../CommandRouter";
import { RuntimeConfig } from "../models/runtimeConfig.model";
import { BotConfig, type GlobalConfig } from "../models/botConfig.model";
import type TextCommandHandler from "../commands/CommandHandler";
import type { runtimeConfig } from "../database/schema";

const globals: GlobalConfig = {
  LOG_LEVEL: "info",
  DATABASE_URI: ":memory:",
  HEALTHCHECK_PORT: 3000,
};

const CLIENT_ID = "123456789012345678";

function makeConfig(): BotConfig {
  return BotConfig.fromRosterEntry(
    { name: "test", discordToken: "token", mailGuildId: "guild-1" },
    CLIENT_ID,
    globals
  );
}

function makeRouter(prefix = "-", commands?: TextCommandHandler[]) {
  const row: typeof runtimeConfig.$inferSelect = {
    guildId: "guild-1",
    openTagId: null,
    closedTagId: null,
    prefix,
    forumChannelId: null,
    logsChannelId: null,
    requiredRoleIds: "[]",
    initialMessage: null,
    anonymousSnippets: true,
    notificationRoleId: null,
    notificationSilent: false,
    botStatus: null,
    applicationId: null,
  };

  const runtimeConfigRepository = {
    getConfig: async () => RuntimeConfig.fromDatabaseRow(row),
  };

  return new CommandRouter(runtimeConfigRepository, makeConfig(), commands);
}

function makeMessage(content: string): Message<true> {
  return { content, guildId: "guild-1" } as Message<true>;
}

function makeGuildMessage(
  content: string,
  overrides: Partial<Message> = {}
): Message<true> {
  return {
    content,
    guildId: "guild-1",
    author: { bot: false },
    member: {
      permissions: new PermissionsBitField(
        PermissionsBitField.Flags.ManageGuild
      ),
      roles: { cache: new Map() },
    },
    inGuild: () => true,
    ...overrides,
  } as unknown as Message<true>;
}

describe("CommandRouter prefix matching", () => {
  it("matches the configured text prefix", async () => {
    const router = makeRouter("-");
    expect(await router.isCommand(makeMessage("-help"))).toBe(true);
    expect(await router.stripPrefix(makeMessage("-help"))).toBe("help");
  });

  it("matches a plain @mention prefix", async () => {
    const router = makeRouter("-");
    const msg = makeMessage(`<@${CLIENT_ID}> help`);
    expect(await router.isCommand(msg)).toBe(true);
    expect(await router.stripPrefix(msg)).toBe("help");
  });

  it("matches a nickname @mention prefix (<@!id>)", async () => {
    const router = makeRouter("-");
    const msg = makeMessage(`<@!${CLIENT_ID}> help`);
    expect(await router.isCommand(msg)).toBe(true);
    expect(await router.stripPrefix(msg)).toBe("help");
  });

  it("does not match a mention of a different user", async () => {
    const router = makeRouter("-");
    const msg = makeMessage(`<@999999999999999999> help`);
    expect(await router.isCommand(msg)).toBe(false);
    expect(await router.stripPrefix(msg)).toBe(null);
  });

  it("returns null when neither prefix nor mention matches", async () => {
    const router = makeRouter("-");
    const msg = makeMessage("hello there");
    expect(await router.isCommand(msg)).toBe(false);
    expect(await router.stripPrefix(msg)).toBe(null);
  });

  it("matches a mention with no space before the command", async () => {
    const router = makeRouter("-");
    const msg = makeMessage(`<@${CLIENT_ID}>help`);
    expect(await router.isCommand(msg)).toBe(true);
    expect(await router.stripPrefix(msg)).toBe("help");
  });
});

describe("CommandRouter handleMessage dispatch via mention", () => {
  it("invokes the matching command handler with parsed args", async () => {
    const called: { args: string[] | null } = { args: null };

    const helpCommand: TextCommandHandler = {
      commandName: "help",
      subCommandName: null,
      aliases: [],
      requiresPrimaryServer: false,
      handler: async (_msg, args) => {
        called.args = args;
      },
    };

    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> help me please`);

    await router.handleMessage(msg);

    expect(called.args).toEqual(["me", "please"]);
  });
});

describe("CommandRouter whitespace handling", () => {
  it("does not produce empty-string args from repeated spaces", async () => {
    const router = makeRouter("-");
    const [commandName, subCommandName, args] =
      await router.breakDownMessage("logs   123");

    expect(commandName).toBe("logs");
    expect(subCommandName).toBeNull();
    expect(args).toEqual(["123"]);
  });

  it("splits on tabs as well as spaces", async () => {
    const router = makeRouter("-");
    const [commandName, , args] = await router.breakDownMessage(
      "reply\thello\tthere"
    );

    expect(commandName).toBe("reply");
    expect(args).toEqual(["hello", "there"]);
  });
});
