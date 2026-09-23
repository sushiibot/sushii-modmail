import { describe, it, expect, beforeEach } from "bun:test";
import { Message, PermissionsBitField } from "discord.js";
import CommandRouter from "../CommandRouter";
import { RuntimeConfig } from "../models/runtimeConfig.model";
import { BotConfig, type GlobalConfig } from "../models/botConfig.model";
import type TextCommandHandler from "../commands/CommandHandler";
import type { runtimeConfig } from "../database/schema";
import { GuildOwnershipConflictError } from "../repositories/errors";

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

  it("matches the bot's managed role mention", async () => {
    const router = makeRouter("-");
    const msg = {
      content: "<@&555555555555555555> help",
      guildId: "guild-1",
      guild: {
        members: { me: { roles: { botRole: { id: "555555555555555555" } } } },
      },
    } as unknown as Message<true>;
    expect(await router.stripPrefix(msg)).toBe("help");
  });

  it("does not match a mention of some other role", async () => {
    const router = makeRouter("-");
    const msg = {
      content: "<@&444444444444444444> help",
      guildId: "guild-1",
      guild: {
        members: { me: { roles: { botRole: { id: "555555555555555555" } } } },
      },
    } as unknown as Message<true>;
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

  it("preserves newlines in rawArgs even though args are tokenized", async () => {
    const router = makeRouter("-");
    const [commandName, , args, rawArgs] = await router.breakDownMessage(
      "reply line one\nline two"
    );

    expect(commandName).toBe("reply");
    expect(args).toEqual(["line", "one", "line", "two"]);
    expect(rawArgs).toBe("line one\nline two");
  });

  it("preserves newlines in rawArgs after a subcommand name", async () => {
    const parent: TextCommandHandler = {
      commandName: "bot",
      subCommandName: null,
      aliases: [],
      requiresPrimaryServer: false,
      handler: async () => {},
    };
    const addSubcommand: TextCommandHandler = {
      commandName: "bot",
      subCommandName: "add",
      aliases: [],
      requiresPrimaryServer: false,
      handler: async () => {},
    };

    const router = makeRouter("-", [parent, addSubcommand]);
    const [commandName, subCommandName, , rawArgs] =
      await router.breakDownMessage("bot add foo\nbar");

    expect(commandName).toBe("bot");
    expect(subCommandName).toBe("add");
    expect(rawArgs).toBe("foo\nbar");
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
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("-help", {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleMessage(msg);

    expect(sent.length).toBe(1);
    expect(JSON.stringify(sent[0])).toContain(CLIENT_ID);
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

describe("CommandRouter.handleUnprefixedMessage (staff toolbar reply-to-toolbar shortcut)", () => {
  const helpCommand: TextCommandHandler = {
    commandName: "help",
    subCommandName: null,
    aliases: [],
    requiresPrimaryServer: false,
    handler: async (_msg, args) => {
      called.args = args;
    },
  };

  let called: { args: string[] | null };

  beforeEach(() => {
    called = { args: null };
  });

  it("dispatches a registered command without any prefix or mention", async () => {
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("help me please");

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toEqual(["me", "please"]);
  });

  it("still enforces the normal staff permission check", async () => {
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("help", {
      member: {
        permissions: new PermissionsBitField(),
        roles: { cache: new Map() },
      },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toBeNull();
  });

  it("does not grant owner-only commands access without an @mention", async () => {
    const OWNER_ID = "owner-user-id";
    const ownerCalled: string[][] = [];
    const botCommand: TextCommandHandler = {
      commandName: "bot",
      subCommandName: null,
      aliases: [],
      requiresPrimaryServer: false,
      ownerOnly: true,
      handler: async (_msg, args) => {
        ownerCalled.push(args);
      },
    };
    const config = makeConfig();
    const router = makeRouter("-", [botCommand], config);
    const msg = makeGuildMessage("bot list", {
      author: { bot: false, id: config.ownerUserId },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(ownerCalled.length).toBe(0);
  });

  it("does not fire the prefix-deprecation warning", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("help", {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(sent.length).toBe(0);
  });

  it("stays silent for a bare toolbar reply that isn't a command", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("this is not a command", {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toBeNull();
    expect(sent.length).toBe(0);
  });

  it("replies with a hint when the bot is mentioned with an unknown command", async () => {
    const sent: { content?: string }[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> this is not a command`, {
      channel: { send: async (content: { content?: string }) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toBeNull();
    expect(sent.length).toBe(1);
    expect(sent[0].content).toContain("Unknown command `this`");
  });

  it("does not send the unknown-command hint to non-staff", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> whatever`, {
      member: {
        permissions: new PermissionsBitField(),
        roles: { cache: new Map() },
      },
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(sent.length).toBe(0);
  });

  it("does not send the hint for a bare mention with no command", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}>`, {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(sent.length).toBe(0);
  });

  it("strips a leading bot @mention before dispatching", async () => {
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> help me please`);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toEqual(["me", "please"]);
  });

  it("strips a leading text prefix before dispatching, without the deprecation warning", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("-help me", {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toEqual(["me"]);
    expect(sent.length).toBe(0);
  });

  it("stays silent for a markdown bullet that starts with the text prefix", async () => {
    const sent: unknown[] = [];
    let fallbackCalls = 0;
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("- also check their alt", {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg, {
      onUnknownCommand: async () => {
        fallbackCalls++;
        return false;
      },
    });

    expect(called.args).toBeNull();
    expect(fallbackCalls).toBe(1);
    expect(sent.length).toBe(0);
  });

  it("lets the fallback handle a mentioned non-command without a hint", async () => {
    const sent: unknown[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> greet`, {
      channel: { send: async (content: unknown) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg, {
      onUnknownCommand: async () => true,
    });

    expect(sent.length).toBe(0);
  });

  it("hints when a mentioned non-command isn't handled by the fallback either", async () => {
    const sent: { content?: string }[] = [];
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> greet`, {
      channel: { send: async (content: { content?: string }) => sent.push(content) },
    } as never);

    await router.handleUnprefixedMessage(msg, {
      onUnknownCommand: async () => false,
    });

    expect(sent.length).toBe(1);
    expect(sent[0].content).toContain("Unknown command `greet`");
  });

  it("does not offer a bare, unaddressed reply to the fallback", async () => {
    let fallbackCalls = 0;
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("greet");

    await router.handleUnprefixedMessage(msg, {
      onUnknownCommand: async () => {
        fallbackCalls++;
        return true;
      },
    });

    expect(fallbackCalls).toBe(0);
  });

  it("does not run the fallback when a command matched", async () => {
    let fallbackCalls = 0;
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> help`);

    await router.handleUnprefixedMessage(msg, {
      onUnknownCommand: async () => {
        fallbackCalls++;
        return true;
      },
    });

    expect(called.args).toEqual([]);
    expect(fallbackCalls).toBe(0);
  });

  it("swallows GuildOwnershipConflictError from another bot's guild", async () => {
    const runtimeConfigRepository = {
      getConfig: async (guildId: string): Promise<RuntimeConfig> => {
        throw new GuildOwnershipConflictError(guildId, CLIENT_ID, "other-app");
      },
    };
    const router = new CommandRouter(runtimeConfigRepository, makeConfig(), [
      helpCommand,
    ]);

    await router.handleUnprefixedMessage(makeGuildMessage("-help"));
    await router.handleUnprefixedMessage(makeGuildMessage("help"));

    expect(called.args).toBeNull();
  });

  it("rethrows errors other than GuildOwnershipConflictError", async () => {
    const runtimeConfigRepository = {
      getConfig: async (): Promise<RuntimeConfig> => {
        throw new Error("db down");
      },
    };
    const router = new CommandRouter(runtimeConfigRepository, makeConfig(), [
      helpCommand,
    ]);

    await expect(
      router.handleUnprefixedMessage(makeGuildMessage("-help"))
    ).rejects.toThrow("db down");
  });

  it("strips a leading bot managed-role mention before dispatching", async () => {
    const router = makeRouter("-", [helpCommand]);
    const msg = makeGuildMessage("<@&555555555555555555> help me", {
      guild: {
        members: { me: { roles: { botRole: { id: "555555555555555555" } } } },
      },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(called.args).toEqual(["me"]);
  });

  it("grants owner-only commands when the toolbar reply @mentions the bot", async () => {
    const ownerCalled: string[][] = [];
    const botCommand: TextCommandHandler = {
      commandName: "bot",
      subCommandName: null,
      aliases: [],
      requiresPrimaryServer: false,
      ownerOnly: true,
      handler: async (_msg, args) => {
        ownerCalled.push(args);
      },
    };
    const config = makeConfig({ OWNER_USER_ID: "owner-user-id" });
    const router = makeRouter("-", [botCommand], config);
    const msg = makeGuildMessage(`<@${CLIENT_ID}> bot list`, {
      author: { bot: false, id: "owner-user-id" },
    } as never);

    await router.handleUnprefixedMessage(msg);

    expect(ownerCalled).toEqual([["list"]]);
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
