import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ToolbarService, withToolbar } from "../../services/ToolbarService";
import { randomSnowflakeID } from "tests/utils/snowflake";
import { StaffThreadView } from "views/StaffThreadView";
import {
  ComponentType,
  ContainerBuilder,
  DiscordAPIError,
  RESTJSONErrorCodes,
} from "discord.js";

// StaffThreadView's render functions are exercised directly (not mocked
// away) in most tests here, since renderMessageBase's whole job is
// dispatching to them correctly -- but other spec files spyOn() these same
// static methods without restoring, and bun shares module state across
// files in one run. Restore after every test so this file's real-render
// assertions can't be left stubbed by a leaked mock from elsewhere.
beforeEach(() => {
  mock.restore();
});
afterEach(() => {
  mock.restore();
});

function mockFetchedMessage(createdTimestamp = 1700000000000) {
  return {
    createdTimestamp,
    components: [{ type: ComponentType.Container, components: [] }],
  };
}

function mockSnippet(overrides: Partial<{ name: string; pinnedPosition: number | null }> = {}) {
  return {
    guildId: "guild-1",
    name: overrides.name ?? "snippet",
    content: "content",
    pinnedPosition: overrides.pinnedPosition ?? null,
  };
}

function unknownMessageError() {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
    RESTJSONErrorCodes.UnknownMessage,
    404,
    "PATCH",
    "/channels/x/messages/y",
    {}
  );
}

describe("withToolbar", () => {
  it("appends the toolbar as a second top-level component, after the base ones", () => {
    const base = [{ id: "base-1" }, { id: "base-2" }];
    const toolbar = new ContainerBuilder();

    const combined = withToolbar(base, toolbar);

    expect(combined).toEqual([base[0], base[1], toolbar]);
  });

  it("doesn't mutate the base array", () => {
    const base = [{ id: "base-1" }];
    withToolbar(base, new ContainerBuilder());

    expect(base).toEqual([{ id: "base-1" }]);
  });

  it("works with an empty base (e.g. a content-less system message)", () => {
    const toolbar = new ContainerBuilder();
    expect(withToolbar([], toolbar)).toEqual([toolbar]);
  });
});

describe("ToolbarService", () => {
  let client: any;
  let snippetService: any;
  let threadRepository: any;
  let messageRepository: any;
  let emojiRepository: any;
  let channel: any;
  let service: ToolbarService;

  const threadChannelId = randomSnowflakeID();
  const guildId = "guild-1";
  let nextSentId = 0;

  beforeEach(() => {
    nextSentId = 0;
    channel = {
      isSendable: mock().mockReturnValue(true),
      isTextBased: mock().mockReturnValue(true),
      send: mock().mockImplementation(async () => ({
        id: `sent-msg-${++nextSentId}`,
      })),
      messages: {
        fetch: mock().mockResolvedValue(mockFetchedMessage()),
        edit: mock().mockResolvedValue({ id: "edited-msg-id" }),
        delete: mock().mockResolvedValue(undefined),
      },
    };

    client = {
      channels: {
        fetch: mock().mockResolvedValue(channel),
      },
      users: {
        fetch: mock().mockResolvedValue({
          id: "author-id",
          username: "author",
          displayAvatarURL: () => "https://example.com/a.png",
        }),
      },
    };

    snippetService = {
      getAllSnippets: mock().mockResolvedValue([]),
    };

    threadRepository = {
      getThreadByChannelId: mock().mockResolvedValue({
        guildId,
        toolbarMessageId: null,
        toolbarIsStandalone: true,
        isClosed: false,
      }),
      setToolbarMessageId: mock().mockResolvedValue(undefined),
    };

    messageRepository = {
      getByThreadMessageId: mock().mockResolvedValue(null),
      getMessageVersions: mock().mockResolvedValue([]),
    };

    emojiRepository = {
      getEmojiMap: mock().mockResolvedValue({}),
    };

    service = new ToolbarService(
      client,
      snippetService,
      threadRepository,
      messageRepository,
      emojiRepository
    );
  });

  describe("send", () => {
    it("does nothing if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.send(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
    });

    it("sends a new toolbar and persists its message ID", async () => {
      await service.send(threadChannelId);

      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        "sent-msg-1",
        true
      );
    });

    it("does nothing if the thread is closed (no reopen exists, so nothing should resurrect the toolbar)", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: null,
        toolbarIsStandalone: true,
        isClosed: true,
      });

      await service.send(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
    });

    it("splits pinned and unpinned snippets when building the message", async () => {
      const pinned = mockSnippet({ name: "pinned-one", pinnedPosition: 1 });
      const unpinned = mockSnippet({ name: "unpinned-one" });
      snippetService.getAllSnippets.mockResolvedValue([pinned, unpinned]);

      await service.send(threadChannelId);

      const sentMessage = channel.send.mock.calls[0][0];
      const container = sentMessage.components[0].toJSON();
      const flattenedLabels = JSON.stringify(container);

      expect(flattenedLabels).toContain("pinned-one");
      expect(flattenedLabels).toContain("unpinned-one");
    });

    it("does nothing if the channel is not sendable", async () => {
      channel.isSendable.mockReturnValue(false);

      await service.send(threadChannelId);

      expect(threadRepository.setToolbarMessageId).not.toHaveBeenCalled();
    });
  });

  describe("relay", () => {
    it("sends fresh (no toolbar) when the thread is closed", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: true,
        isClosed: true,
      });
      const content = { content: "hello" } as any;

      const sent = await service.relay(threadChannelId, content);

      expect(channel.send).toHaveBeenCalledWith(content);
      expect(sent.id).toBe("sent-msg-1");
      expect(channel.messages.edit).not.toHaveBeenCalled();
    });

    it("sends a real new message with the toolbar composed on top, and stores it as a non-standalone bearer", async () => {
      const content = { content: "hello", components: [{ id: "base" }] } as any;

      const sent = await service.relay(threadChannelId, content);

      const sentPayload = channel.send.mock.calls[0][0];
      expect(sentPayload.components).toHaveLength(2);
      expect(sentPayload.components[0]).toEqual({ id: "base" });
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        sent.id,
        false
      );
    });

    it("deletes the previous bearer when it was standalone (toolbar-only)", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: true,
        isClosed: false,
      });

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(channel.messages.delete).toHaveBeenCalledWith("old-bearer");
      expect(channel.messages.edit).not.toHaveBeenCalled();
      // isStandalone alone decides this -- the row lookup is never even
      // consulted for a standalone bearer.
      expect(messageRepository.getByThreadMessageId).not.toHaveBeenCalled();
    });

    it("re-renders and edits the previous bearer in place when it's a non-standalone overlay bearer with a DB row", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      const staffRow = {
        isStaff: () => true,
        isUser: () => false,
        messageId: "old-bearer",
        authorId: "author-id",
        content: "previous content",
        forwarded: false,
        isAnonymous: false,
        isPlainText: false,
        isSnippet: false,
        dmFailed: null,
        editedById: null,
      };
      messageRepository.getByThreadMessageId.mockResolvedValue(staffRow);

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(channel.messages.edit).toHaveBeenCalledWith(
        "old-bearer",
        expect.objectContaining({ components: expect.any(Array) })
      );
      // Base re-render only -- no toolbar container appended.
      expect(channel.messages.edit.mock.calls[0][1].components).toHaveLength(1);
    });

    it("never deletes a non-standalone overlay bearer whose message row hasn't committed yet", async () => {
      // Regression: the row for a relay's own bearer is saved by the
      // CALLER (e.g. MessageRelayService.relayUserMessageToStaff) only
      // after relay() returns, outside this lock. A fast-following second
      // relay must not infer "no row yet" as "safe to delete" -- that
      // would destroy real, not-yet-persisted content.
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockResolvedValue(null);

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(channel.messages.edit).not.toHaveBeenCalled();
    });

    it("does not strip when there was no previous bearer", async () => {
      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(channel.messages.edit).not.toHaveBeenCalled();
      expect(channel.messages.delete).not.toHaveBeenCalled();
    });

    it("falls back to a separate standalone toolbar message when composing would exceed the CV2 component budget", async () => {
      // 41 button-like nodes in the base -- alone already over budget with
      // the toolbar's own handful of components added on top.
      const manyComponents = Array.from({ length: 41 }, (_, i) => ({
        type: 2,
        id: i,
      }));
      const content = { content: "hello", components: manyComponents } as any;

      const sent = await service.relay(threadChannelId, content);

      // Two sends: the content as-is, then the toolbar as its own message.
      expect(channel.send).toHaveBeenCalledTimes(2);
      expect(channel.send.mock.calls[0][0]).toBe(content);
      expect(sent.id).toBe("sent-msg-1");
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        "sent-msg-2",
        true
      );
    });

    it("serializes overlapping relays for the same thread", async () => {
      // Stateful thread + row lookups, unlike the other tests' static
      // mocks -- this is the only way to actually observe a race: a
      // broken lock would let the second relay read the pre-relay bearer
      // and edit the message the first relay just made the live bearer.
      let storedToolbarMessageId: string | null = "toolbar-msg-id";
      let storedIsStandalone = false;
      threadRepository.getThreadByChannelId.mockImplementation(async () => ({
        guildId,
        toolbarMessageId: storedToolbarMessageId,
        toolbarIsStandalone: storedIsStandalone,
        isClosed: false,
      }));
      threadRepository.setToolbarMessageId.mockImplementation(
        async (_channelId: string, messageId: string | null, isStandalone: boolean) => {
          storedToolbarMessageId = messageId;
          storedIsStandalone = isStandalone;
        }
      );
      messageRepository.getByThreadMessageId.mockImplementation(
        async (messageId: string) => ({
          isStaff: () => true,
          isUser: () => false,
          messageId,
          authorId: "author-id",
          content: "x",
          forwarded: false,
          isAnonymous: false,
          isPlainText: false,
          isSnippet: false,
          dmFailed: null,
          editedById: null,
        })
      );

      const editTargets: string[] = [];
      channel.messages.edit.mockImplementation(async (id: string) => {
        editTargets.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: `edited-${id}` };
      });

      await Promise.all([
        service.relay(threadChannelId, { content: "a" } as any),
        service.relay(threadChannelId, { content: "b" } as any),
      ]);

      // The second relay's strip must target the bearer the first relay
      // just posted ("sent-msg-1"), never the original "toolbar-msg-id"
      // a second time -- a broken lock would let both reads see the
      // pre-relay bearer.
      expect(editTargets).toEqual(["toolbar-msg-id", "sent-msg-1"]);
    });

    it("throws if the channel is not text-based", async () => {
      channel.isTextBased.mockReturnValue(false);

      await expect(
        service.relay(threadChannelId, { content: "x" } as any)
      ).rejects.toThrow();
    });

    it("does not lose the relayed message if stripping the previous bearer fails", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockRejectedValue(
        new Error("db unavailable")
      );

      const sent = await service.relay(threadChannelId, { content: "x" } as any);

      expect(sent.id).toBe("sent-msg-1");
    });

    it("swallows UnknownMessage when the previous standalone bearer is already gone", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "already-gone",
        toolbarIsStandalone: true,
        isClosed: false,
      });
      channel.messages.delete.mockRejectedValue(unknownMessageError());

      await expect(
        service.relay(threadChannelId, { content: "x" } as any)
      ).resolves.toBeDefined();
    });
  });

  describe("reapplyIfBearer", () => {
    const base = { components: [{ id: "base" }], flags: 1 } as any;

    it("appends the overlay when the message is the current bearer", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        isClosed: false,
      });

      const result = await service.reapplyIfBearer(
        threadChannelId,
        "bearer-id",
        base
      );

      expect(result.components).toHaveLength(2);
      expect((result.components as any[])[0]).toEqual({ id: "base" });
    });

    it("returns the base options unchanged when the message is not the bearer", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "some-other-message",
        isClosed: false,
      });

      const result = await service.reapplyIfBearer(
        threadChannelId,
        "bearer-id",
        base
      );

      expect(result).toBe(base);
    });

    it("returns the base options unchanged in a closed thread, never re-adding a live Close button", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        isClosed: true,
      });

      const result = await service.reapplyIfBearer(
        threadChannelId,
        "bearer-id",
        base
      );

      expect(result).toBe(base);
    });

    it("returns the base options unchanged if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      const result = await service.reapplyIfBearer(
        threadChannelId,
        "bearer-id",
        base
      );

      expect(result).toBe(base);
    });

    it("leaves the edit stripped rather than exceeding the component budget", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        isClosed: false,
      });
      const manyComponents = Array.from({ length: 41 }, (_, i) => ({
        type: 2,
        id: i,
      }));

      const result = await service.reapplyIfBearer(threadChannelId, "bearer-id", {
        components: manyComponents,
      } as any);

      expect(result.components).toHaveLength(41);
    });
  });

  describe("close", () => {
    it("deletes a standalone bearer outright, without sending anything new", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: true,
        isClosed: false,
      });

      await service.close(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.messages.delete).toHaveBeenCalledWith("bearer-id");
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        null,
        false
      );
    });

    it("re-renders base content (no toolbar) when the bearer is a non-standalone overlay with a DB row", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockResolvedValue({
        isStaff: () => false,
        isUser: () => true,
        messageId: "bearer-id",
        authorId: "author-id",
        content: "hi",
        forwarded: false,
      });

      await service.close(threadChannelId);

      expect(channel.messages.edit).toHaveBeenCalledWith(
        "bearer-id",
        expect.objectContaining({ components: expect.any(Array) })
      );
    });

    it("never deletes a non-standalone overlay bearer whose row is (transiently) missing", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockResolvedValue(null);

      await service.close(threadChannelId);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(channel.messages.edit).not.toHaveBeenCalled();
      // Still clears the pointer -- the thread is closing regardless.
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        null,
        false
      );
    });

    it("does nothing if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.close(threadChannelId);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(threadRepository.setToolbarMessageId).not.toHaveBeenCalled();
    });

    it("clears the toolbar pointer even if there was no bearer message", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: null,
        toolbarIsStandalone: true,
        isClosed: false,
      });

      await service.close(threadChannelId);

      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        null,
        false
      );
    });
  });

  describe("refresh", () => {
    it("re-composes the overlay on the current bearer without dropping its base content", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockResolvedValue({
        isStaff: () => false,
        isUser: () => true,
        messageId: "bearer-id",
        authorId: "author-id",
        content: "hi",
        forwarded: false,
      });

      await service.refresh(threadChannelId);

      expect(channel.messages.edit).toHaveBeenCalledWith(
        "bearer-id",
        expect.objectContaining({ components: expect.any(Array) })
      );
      const editedComponents = channel.messages.edit.mock.calls[0][1].components;
      expect(editedComponents.length).toBeGreaterThan(1);
      expect(channel.send).not.toHaveBeenCalled();
    });

    it("posts a fresh toolbar if there's no existing bearer to edit", async () => {
      await service.refresh(threadChannelId);

      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        "sent-msg-1",
        true
      );
    });

    it("falls back to posting fresh if the existing bearer message is already gone", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "already-gone",
        isClosed: false,
      });
      channel.messages.fetch.mockRejectedValue(unknownMessageError());

      await service.refresh(threadChannelId);

      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("does nothing if the thread is closed", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        isClosed: true,
      });

      await service.refresh(threadChannelId);

      expect(channel.messages.edit).not.toHaveBeenCalled();
      expect(channel.send).not.toHaveBeenCalled();
    });

    it("does nothing if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.refresh(threadChannelId);

      expect(channel.messages.edit).not.toHaveBeenCalled();
      expect(channel.send).not.toHaveBeenCalled();
    });
  });

  describe("renderMessageBase strip faithfulness", () => {
    const staffRow = {
      isStaff: () => true,
      isUser: () => false,
      messageId: "old-bearer",
      authorId: "author-id",
      content: "current content",
      forwarded: false,
      isAnonymous: false,
      isPlainText: true,
      isSnippet: false,
      snippetName: null,
      dmFailed: true,
      editedById: "editor-id",
      deletedById: null,
    };

    const userRow = {
      isStaff: () => false,
      isUser: () => true,
      messageId: "old-bearer",
      authorId: "author-id",
      content: "current content",
      forwarded: true,
    };

    beforeEach(() => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-bearer",
        toolbarIsStandalone: false,
        isClosed: false,
      });
    });

    it("dispatches a staff row to staffReplyComponents, passing dmFailed/editedById through so a strip never misrepresents state", async () => {
      messageRepository.getByThreadMessageId.mockResolvedValue(staffRow);
      const spy = spyOn(StaffThreadView, "staffReplyComponents");

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "old-bearer",
          content: "current content",
        }),
        expect.anything(),
        expect.objectContaining({
          anonymous: false,
          plainText: true,
          snippet: false,
        }),
        expect.objectContaining({
          failed: true,
          editedById: "editor-id",
        })
      );
    });

    it("dispatches a user row to userReplyComponents, using only its own [0] (base) components -- never touching edit-history additional messages", async () => {
      messageRepository.getByThreadMessageId.mockResolvedValue(userRow);
      const spy = spyOn(StaffThreadView, "userReplyComponents").mockReturnValue([
        [new ContainerBuilder()],
        [new ContainerBuilder()], // a would-be edit-history additional message
      ]);

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(spy).toHaveBeenCalled();
      expect(channel.messages.edit).toHaveBeenCalledWith(
        "old-bearer",
        expect.objectContaining({ components: expect.any(Array) })
      );
      // Only the primary [0] element, never the additional edit-history one.
      expect(channel.messages.edit.mock.calls[0][1].components).toHaveLength(1);
    });

    it("derives isEdited from message-version history rather than trusting a passed-in flag", async () => {
      messageRepository.getByThreadMessageId.mockResolvedValue(userRow);
      messageRepository.getMessageVersions.mockResolvedValue([
        { messageId: "old-bearer", version: 1, content: "old", editedAt: new Date() },
      ]);
      const spy = spyOn(StaffThreadView, "userReplyComponents").mockReturnValue([
        [new ContainerBuilder()],
      ]);

      await service.relay(threadChannelId, { content: "hello" } as any);

      const isEditedArg = spy.mock.calls[0][3];
      expect(isEditedArg).toBe(true);
    });

    it("passes deletedById through so a stripped deleted staff message keeps its attribution", async () => {
      messageRepository.getByThreadMessageId.mockResolvedValue({
        ...staffRow,
        deletedById: "deleter-id",
      });
      const spy = spyOn(StaffThreadView, "staffReplyComponents");

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ deletedById: "deleter-id" })
      );
    });

    it("passes snippetName through so a stripped snippet-sent message keeps its badge", async () => {
      messageRepository.getByThreadMessageId.mockResolvedValue({
        ...staffRow,
        isSnippet: true,
        snippetName: "welcome",
      });
      const spy = spyOn(StaffThreadView, "staffReplyComponents");

      await service.relay(threadChannelId, { content: "hello" } as any);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ snippet: true, snippetName: "welcome" }),
        expect.anything()
      );
    });
  });

  describe("bumpToBottom", () => {
    it("strips the current bearer and reposts a fresh standalone toolbar at the bottom", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: false,
        isClosed: false,
      });
      messageRepository.getByThreadMessageId.mockResolvedValue({
        isStaff: () => false,
        isUser: () => true,
        messageId: "bearer-id",
        authorId: "author-id",
        content: "hi",
        forwarded: false,
      });

      await service.bumpToBottom(threadChannelId);

      // The old bearer is re-rendered in place (it's real content)...
      expect(channel.messages.edit).toHaveBeenCalledWith(
        "bearer-id",
        expect.objectContaining({ components: expect.any(Array) })
      );
      // ...and a fresh standalone toolbar is posted after it.
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        "sent-msg-1",
        true
      );
    });

    it("deletes a standalone bearer instead of re-rendering it", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: true,
        isClosed: false,
      });

      await service.bumpToBottom(threadChannelId);

      expect(channel.messages.delete).toHaveBeenCalledWith("bearer-id");
      expect(channel.messages.edit).not.toHaveBeenCalled();
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when there's no bearer", async () => {
      await service.bumpToBottom(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(channel.messages.edit).not.toHaveBeenCalled();
    });

    it("is a no-op in a closed thread", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "bearer-id",
        toolbarIsStandalone: true,
        isClosed: true,
      });

      await service.bumpToBottom(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.messages.delete).not.toHaveBeenCalled();
    });

    it("is a no-op if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.bumpToBottom(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
    });
  });
});
