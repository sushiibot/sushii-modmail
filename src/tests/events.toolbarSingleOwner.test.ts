import { describe, it, expect } from "bun:test";
import { EventEmitter } from "events";
import { ChannelType, Events, PermissionsBitField, type Client } from "discord.js";
import { getDb } from "../database/db";
import { registerEventHandlers } from "../events";
import CommandRouter from "../CommandRouter";
import { RuntimeConfigRepository } from "../repositories/runtimeConfig.repository";
import { ThreadRepository } from "../repositories/thread.repository";
import { BotConfig, type GlobalConfig } from "../models/botConfig.model";
import { BotManager } from "../services/BotManager";
import { buildSharedServices } from "../services/botFactory";
import { SnippetRepository } from "../repositories/snippet.repository";
import { CloseCommand } from "../commands/CloseCommand";
import { AddSnippetCommand } from "../commands/snippets/AddSnippetCommand";

const globals: GlobalConfig = {
  LOG_LEVEL: "info",
  DATABASE_URI: ":memory:",
  HEALTHCHECK_PORT: 3000,
};

function makeFakeThreadChannel(id: string) {
  return {
    id,
    isThread: () => true,
    isTextBased: () => true,
    isSendable: () => true,
    appliedTags: [],
    send: async () => ({ id: "sent-msg-id" }),
    edit: async () => {},
    messages: { delete: async () => {} },
  };
}

function makeFakeForumChannel() {
  const availableTags: { id: string; name: string }[] = [];
  return {
    type: ChannelType.GuildForum,
    get availableTags() {
      return availableTags;
    },
    setAvailableTags: async (tags: { name: string }[]) => {
      availableTags.length = 0;
      availableTags.push(
        ...tags.map((t, i) => ({ id: `tag-${i}-${t.name}`, ...t }))
      );
      return { availableTags };
    },
  };
}

function makeFakeClient(threadChannelId: string, forumChannelId: string): Client {
  const emitter = new EventEmitter();
  const threadChannel = makeFakeThreadChannel(threadChannelId);
  const forumChannel = makeFakeForumChannel();
  return Object.assign(emitter, {
    user: { id: "bot-user-id", tag: "TestBot#0000", setPresence: () => {} },
    guilds: { fetch: async () => ({}) },
    channels: {
      fetch: async (id: string) => {
        if (id === threadChannelId) return threadChannel;
        if (id === forumChannelId) return forumChannel;
        return null;
      },
    },
  }) as unknown as Client;
}

// This drives the real MessageCreate wiring in events.ts -- specifically
// the early-return that hands a reply-to-toolbar message exclusively to
// CommandRouter.handleUnprefixedMessage before the normal (prefixed)
// command path or the snippet trigger ever see it. Testing
// ToolbarController.isReplyToToolbar in isolation (see
// ToolbarController.test.ts) proves the routing decision is correct, but
// not that the real event handler actually dispatches through the command
// router instead of the other two paths -- that's what this test exercises.
describe("reply-to-toolbar single-owner wiring (via registerEventHandlers)", () => {
  async function setup() {
    const guildId = "100000000000000001";
    const forumChannelId = "100000000000000002";
    const threadChannelId = "100000000000000003";
    const userId = "100000000000000004";
    const staffId = "100000000000000005";
    const toolbarMessageId = "100000000000000006";

    const db = getDb(":memory:");
    const config = BotConfig.fromRosterEntry(
      {
        applicationId: "app-id",
        name: "lisa",
        discordToken: "token",
        mailGuildId: guildId,
      },
      globals
    );

    const runtimeConfigRepository = new RuntimeConfigRepository(
      db,
      config.discordClientId
    );
    await runtimeConfigRepository.setConfig(guildId, { forumChannelId });

    const threadRepository = new ThreadRepository(db, guildId);
    await threadRepository.createThread(guildId, userId, threadChannelId);
    await threadRepository.setToolbarMessageId(threadChannelId, toolbarMessageId);

    const client = makeFakeClient(threadChannelId, forumChannelId);
    const commandRouter = new CommandRouter(runtimeConfigRepository, config);
    const botManager = new BotManager(db, globals);
    const shared = buildSharedServices(config, client, db);

    // Registering only the two commands this test's scenarios need --
    // proves generic dispatch works for a real, arbitrary command, not
    // just that the wiring happens to route somewhere.
    commandRouter.addCommands(
      new CloseCommand(shared.threadService, runtimeConfigRepository),
      new AddSnippetCommand(shared.snippetService)
    );

    registerEventHandlers(config, client, db, commandRouter, botManager, shared);

    function mockMessage(content: string) {
      return {
        author: { id: staffId, bot: false, username: "staffer" },
        member: {
          permissions: {
            has: (flag: bigint) =>
              flag === PermissionsBitField.Flags.ManageGuild,
          },
          roles: { cache: new Map() },
        },
        content,
        reference: { messageId: toolbarMessageId },
        attachments: new Map(),
        stickers: new Map(),
        createdTimestamp: Date.now(),
        id: "incoming-msg-id",
        guildId,
        channel: {
          id: threadChannelId,
          parentId: forumChannelId,
          isThread: () => true,
          send: async () => ({ id: "sent-msg-id" }),
        },
        reply: async () => ({ id: "reply-msg-id" }),
        inGuild: () => true,
        client,
      } as any;
    }

    return { client, db, guildId, threadRepository, mockMessage };
  }

  it("closes the thread via the real MessageCreate wiring when replying 'close' to the toolbar", async () => {
    const { client, threadRepository, mockMessage } = await setup();

    (client as unknown as EventEmitter).emit(
      Events.MessageCreate,
      mockMessage("close")
    );

    // Let the async MessageCreate handler run to completion.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const thread = await threadRepository.getThreadByChannelId(
      "100000000000000003"
    );
    expect(thread?.isClosed).toBe(true);
  });

  it("dispatches any registered command generically, not just ar/reply/close", async () => {
    // Regression test: reply-to-toolbar previously hardcoded a 3-word
    // allowlist, so "snippet add <name> <content>" was rejected with
    // "Unknown action" even though it's a real registered command.
    const { client, db, guildId, mockMessage } = await setup();

    (client as unknown as EventEmitter).emit(
      Events.MessageCreate,
      mockMessage("snippet add helpme Hi, what can we help with?")
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const snippetRepository = new SnippetRepository(db);
    const snippet = await snippetRepository.getSnippet(guildId, "helpme");
    expect(snippet?.content).toBe("Hi, what can we help with?");
  });
});
