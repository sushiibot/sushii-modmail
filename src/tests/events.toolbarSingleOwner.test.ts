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
// ToolbarController before commandRouter.handleMessage or
// snippetController.handleThreadMessage ever see it. Testing
// ToolbarController.isReplyToToolbar/handleReplyToToolbar in isolation (see
// ToolbarController.test.ts) proves the parsing logic is correct, but not
// that the real event handler actually calls it instead of the other two
// paths -- that's what this test exercises.
describe("reply-to-toolbar single-owner wiring (via registerEventHandlers)", () => {
  it("closes the thread via the real MessageCreate wiring when replying 'close' to the toolbar", async () => {
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

    registerEventHandlers(config, client, db, commandRouter, botManager, shared);

    const message = {
      author: { id: staffId, bot: false, username: "staffer" },
      member: {
        permissions: {
          has: (flag: bigint) => flag === PermissionsBitField.Flags.ManageGuild,
        },
        roles: { cache: new Map() },
      },
      content: "close",
      reference: { messageId: toolbarMessageId },
      attachments: new Map(),
      stickers: new Map(),
      createdTimestamp: Date.now(),
      id: "incoming-msg-id",
      guildId,
      channel: {
        id: threadChannelId,
        isThread: () => true,
      },
      inGuild: () => true,
      client,
    } as any;

    (client as unknown as EventEmitter).emit(Events.MessageCreate, message);

    // Let the async MessageCreate handler run to completion.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const thread = await threadRepository.getThreadByChannelId(threadChannelId);
    expect(thread?.isClosed).toBe(true);
  });
});
