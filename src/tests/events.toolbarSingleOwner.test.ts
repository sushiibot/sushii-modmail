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
import { EditCommand } from "../commands/EditCommand";
import type { MessageRelayService } from "../services/MessageRelayService";

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

function makeFakeClient(
  threadChannelId: string,
  forumChannelId: string,
  guildId: string
): Client {
  const emitter = new EventEmitter();
  const threadChannel = makeFakeThreadChannel(threadChannelId);
  const forumChannel = makeFakeForumChannel();
  return Object.assign(emitter, {
    user: { id: "bot-user-id", tag: "TestBot#0000", setPresence: () => {} },
    guilds: {
      fetch: async () => ({}),
      cache: new Map([[guildId, { id: guildId }]]),
    },
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
    await threadRepository.setToolbarMessageId(threadChannelId, toolbarMessageId, false);

    const client = makeFakeClient(threadChannelId, forumChannelId, guildId);
    const commandRouter = new CommandRouter(runtimeConfigRepository, config);
    const botManager = new BotManager(db, globals);
    const shared = buildSharedServices(config, client, db);

    const editCalls: { targetId: string; content: string }[] = [];
    const stubMessageService = {
      editStaffMessage: async (
        targetId: string,
        _userId: string,
        _guild: unknown,
        edit: { content: string }
      ) => {
        editCalls.push({ targetId, content: edit.content });
        return { ok: true };
      },
    } as unknown as MessageRelayService;

    // Registering only the commands this test's scenarios need --
    // proves generic dispatch works for a real, arbitrary command, not
    // just that the wiring happens to route somewhere.
    commandRouter.addCommands(
      new CloseCommand(shared.threadService, runtimeConfigRepository),
      new AddSnippetCommand(shared.snippetService),
      new EditCommand(
        shared.threadService,
        stubMessageService,
        runtimeConfigRepository
      )
    );

    const relayedContents: string[] = [];
    shared.messageService.relayStaffMessageToUser = async (
      _threadId,
      _userId,
      _guild,
      msg
    ) => {
      relayedContents.push(msg.content);
    };

    await new SnippetRepository(db).createSnippet(guildId, "greet", "Hello!");

    registerEventHandlers(config, client, db, commandRouter, botManager, shared);

    const channelSends: unknown[] = [];

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
          send: async (options: unknown) => {
            channelSends.push(options);
            return { id: "sent-msg-id" };
          },
          messages: {
            fetch: async () => ({ author: { id: "bot-user-id" } }),
          },
        },
        reply: async () => ({ id: "reply-msg-id" }),
        react: async () => {},
        delete: async () => {},
        inGuild: () => true,
        client,
      } as any;
    }

    return {
      client,
      db,
      guildId,
      threadRepository,
      mockMessage,
      editCalls,
      channelSends,
      relayedContents,
      toolbarMessageId,
      discordClientId: config.discordClientId,
    };
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

  async function emitAndSettle(client: Client, message: unknown) {
    (client as unknown as EventEmitter).emit(Events.MessageCreate, message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it("dispatches `@bot edit ...` replied to the toolbar message to EditCommand", async () => {
    const { client, mockMessage, editCalls, toolbarMessageId, discordClientId } =
      await setup();

    await emitAndSettle(client, mockMessage(`<@${discordClientId}> edit new text`));

    expect(editCalls).toEqual([{ targetId: toolbarMessageId, content: "new text" }]);
  });

  it("preserves multi-line edit content after an @mention", async () => {
    const { client, mockMessage, editCalls, toolbarMessageId, discordClientId } =
      await setup();

    await emitAndSettle(
      client,
      mockMessage(`<@${discordClientId}> edit line one\n\nline  two`)
    );

    expect(editCalls).toEqual([
      { targetId: toolbarMessageId, content: "line one\n\nline  two" },
    ]);
  });

  it("still dispatches a bare `edit ...` with no prefix or mention", async () => {
    const { client, mockMessage, editCalls, toolbarMessageId } = await setup();

    await emitAndSettle(client, mockMessage("edit new text"));

    expect(editCalls).toEqual([{ targetId: toolbarMessageId, content: "new text" }]);
  });

  it("replies with a hint when a toolbar reply isn't a known command", async () => {
    const { client, mockMessage, editCalls, channelSends, discordClientId } =
      await setup();

    await emitAndSettle(client, mockMessage(`<@${discordClientId}> edt oops`));

    expect(editCalls.length).toBe(0);
    expect(channelSends).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining("Unknown command `edt`"),
      })
    );
  });

  it("sends a snippet for a mentioned toolbar reply, without a hint", async () => {
    const { client, mockMessage, channelSends, relayedContents, discordClientId } =
      await setup();

    await emitAndSettle(client, mockMessage(`<@${discordClientId}> greet`));

    expect(relayedContents).toEqual(["Hello!"]);
    expect(channelSends).toEqual([]);
  });

  it("sends a snippet for a prefixed toolbar reply", async () => {
    const { client, mockMessage, channelSends, relayedContents } = await setup();

    await emitAndSettle(client, mockMessage("-greet"));

    expect(relayedContents).toEqual(["Hello!"]);
    expect(channelSends).toEqual([]);
  });

  it("stays silent for a markdown bullet replied to the toolbar", async () => {
    const { client, mockMessage, channelSends, relayedContents, editCalls } =
      await setup();

    await emitAndSettle(client, mockMessage("- also check their alt"));

    expect(relayedContents).toEqual([]);
    expect(editCalls).toEqual([]);
    expect(channelSends).toEqual([]);
  });
});
