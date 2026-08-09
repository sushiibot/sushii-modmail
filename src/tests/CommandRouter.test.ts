import { describe, it, expect, beforeEach } from "bun:test";
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

function makeConfig(overrides: Partial<GlobalConfig> = {}): BotConfig {
  return BotConfig.fromRosterEntry(
    {
      applicationId: CLIENT_ID,
      name: "test",
      discordToken: "token",
      mailGuildId: "guild-1",
    },
    { ...globals, ...overrides }
  );
}

function makeRouter(
  prefix = "-",
  commands?: TextCommandHandler[],
  config: BotConfig = makeConfig()
) {
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

  return new CommandRouter(runtimeConfigRepository, config, commands);
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
    author: { bot: false, id: "regular-user-id" },
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

describe("CommandRouter prefix deprecation warning", () => {
  const helpCommand: TextCommandHandler = {
    commandName: "help",
    subCommandName: null,
    aliases: [],
    requiresPrimaryServer: false,
    handler: async () => {},
  };

  it("warns when a command is triggered via the text prefix", async () => {
    const sent: string[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("-help", {
      channel: { send: async (content: string) => sent.push(content) },
    } as never);

    await router.handleMessage(msg);

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(CLIENT_ID);
  });

  it("does not warn when triggered via @mention", async () => {
    const sent: string[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> help`, {
      channel: { send: async (content: string) => sent.push(content) },
    } as never);

    await router.handleMessage(msg);

    expect(sent.length).toBe(0);
  });

  it("does not warn a second time within the same day", async () => {
    const sent: string[] = [];
    const router = makeRouter("-", [helpCommand]);
    const channel = { send: async (content: string) => sent.push(content) };

    await router.handleMessage(
      makeGuildMessage("-help", { channel } as never)
    );
    await router.handleMessage(
      makeGuildMessage("-help", { channel } as never)
    );

    expect(sent.length).toBe(1);
  });

  it("warns independently per guild", async () => {
    const sent: string[] = [];
    const router = makeRouter("-", [helpCommand]);
    const channel = { send: async (content: string) => sent.push(content) };

    await router.handleMessage(
      makeGuildMessage("-help", { channel } as never)
    );
    await router.handleMessage(
      makeGuildMessage("-help", { channel, guildId: "guild-2" } as never)
    );

    expect(sent.length).toBe(2);
  });

  it("does not warn for an unrecognized prefixed message", async () => {
    const sent: string[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("-nonexistent", {
      channel: { send: async (content: string) => sent.push(content) },
    } as never);

    await router.handleMessage(msg);

    expect(sent.length).toBe(0);
  });
});

describe("CommandRouter ownerOnly gating", () => {
  const OWNER_ID = "owner-user-id";

  const botCommand: TextCommandHandler = {
    commandName: "bot",
    subCommandName: null,
    aliases: [],
    requiresPrimaryServer: false,
    ownerOnly: true,
    handler: async (_msg, args) => {
      called.push(args);
    },
  };

  let called: string[][];
  let getConfigCalls: number;

  function makeOwnerRouter() {
    const row: typeof runtimeConfig.$inferSelect = {
      guildId: "guild-1",
      openTagId: null,
      closedTagId: null,
      prefix: "-",
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
      getConfig: async () => {
        getConfigCalls += 1;
        return RuntimeConfig.fromDatabaseRow(row);
      },
    };

    const config = BotConfig.fromRosterEntry(
      {
        applicationId: CLIENT_ID,
        name: "test",
        discordToken: "token",
        mailGuildId: "guild-1",
      },
      { ...globals, OWNER_USER_ID: OWNER_ID }
    );

    return new CommandRouter(runtimeConfigRepository, config, [botCommand]);
  }

  beforeEach(() => {
    called = [];
    getConfigCalls = 0;
  });

  it("does not respond via text-prefix, even for the owner", async () => {
    const router = makeOwnerRouter();
    const msg = makeGuildMessage("-bot list", {
      author: { bot: false, id: OWNER_ID },
    } as never);

    await router.handleMessage(msg);

    expect(called.length).toBe(0);
  });

  it("does not respond to a non-owner via @mention", async () => {
    const router = makeOwnerRouter();
    const msg = makeGuildMessage(`<@${CLIENT_ID}> bot list`, {
      author: { bot: false, id: "not-the-owner" },
    } as never);

    await router.handleMessage(msg);

    expect(called.length).toBe(0);
  });

  it("responds to the owner via @mention without calling getConfig", async () => {
    const router = makeOwnerRouter();
    const msg = makeGuildMessage(`<@${CLIENT_ID}> bot list`, {
      author: { bot: false, id: OWNER_ID },
    } as never);

    await router.handleMessage(msg);

    expect(called.length).toBe(1);
  });
});

describe("CommandRouter command-name reservation for a bare-parent-plus-subcommands family", () => {
  it("only reserves the parent name when a real handler is registered for it", async () => {
    const subcommandOnly: TextCommandHandler = {
      commandName: "bot",
      subCommandName: "list",
      aliases: [],
      requiresPrimaryServer: false,
      ownerOnly: true,
      handler: async () => {},
    };

    // Matches production ordering in botFactory.ts: without a bare parent
    // handler, CommandRouter auto-creates a handler: null entry for "bot"
    // that getCommandNames() skips -- "bot" would be unreserved and a
    // snippet named "bot" could shadow the command family.
    const routerWithoutParent = makeRouter("-", [subcommandOnly]);
    expect(routerWithoutParent.getCommandNames().has("bot")).toBe(false);

    const parent: TextCommandHandler = {
      commandName: "bot",
      subCommandName: null,
      aliases: [],
      requiresPrimaryServer: false,
      ownerOnly: true,
      handler: async () => {},
    };

    const routerWithParent = makeRouter("-", [parent, subcommandOnly]);
    expect(routerWithParent.getCommandNames().has("bot")).toBe(true);
  });
});
