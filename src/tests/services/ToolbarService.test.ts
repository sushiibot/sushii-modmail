import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ToolbarService } from "../../services/ToolbarService";
import { randomSnowflakeID } from "tests/utils/snowflake";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

function mockSnippet(overrides: Partial<{ name: string; pinnedPosition: number | null }> = {}) {
  return {
    guildId: "guild-1",
    name: overrides.name ?? "snippet",
    content: "content",
    pinnedPosition: overrides.pinnedPosition ?? null,
  };
}

describe("ToolbarService", () => {
  let client: any;
  let snippetService: any;
  let threadRepository: any;
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
        edit: mock().mockResolvedValue({ id: "edited-msg-id" }),
        delete: mock().mockResolvedValue(undefined),
      },
    };

    client = {
      channels: {
        fetch: mock().mockResolvedValue(channel),
      },
    };

    snippetService = {
      getAllSnippets: mock().mockResolvedValue([]),
    };

    threadRepository = {
      getThreadByChannelId: mock().mockResolvedValue({
        guildId,
        toolbarMessageId: null,
        isClosed: false,
      }),
      setToolbarMessageId: mock().mockResolvedValue(undefined),
    };

    service = new ToolbarService(client, snippetService, threadRepository);
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
        "sent-msg-1"
      );
    });

    it("does nothing if the thread is closed (no reopen exists, so nothing should resurrect the toolbar)", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: null,
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

  describe("foldReply", () => {
    it("sends fresh when there's no toolbar message to fold into", async () => {
      const content = { content: "hello" } as any;

      const folded = await service.foldReply(threadChannelId, content);

      expect(channel.messages.edit).not.toHaveBeenCalled();
      expect(channel.send).toHaveBeenCalledWith(content);
      expect(folded.id).toBe("sent-msg-1");
    });

    it("edits the existing toolbar message in place instead of deleting it", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-msg-id",
        isClosed: false,
      });
      const content = { content: "reply text" } as any;

      const folded = await service.foldReply(threadChannelId, content);

      expect(channel.messages.edit).toHaveBeenCalledWith(
        "toolbar-msg-id",
        content
      );
      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(folded.id).toBe("edited-msg-id");
    });

    it("posts a fresh placeholder toolbar after folding", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-msg-id",
        isClosed: false,
      });

      await service.foldReply(threadChannelId, { content: "x" } as any);

      // One send for the fresh toolbar posted below the folded reply.
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(threadRepository.setToolbarMessageId).toHaveBeenLastCalledWith(
        threadChannelId,
        "sent-msg-1"
      );
    });

    it("clears the toolbar message ID before posting the fresh one, so nothing treats the folded message as the live toolbar", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-msg-id",
        isClosed: false,
      });

      await service.foldReply(threadChannelId, { content: "x" } as any);

      const calls = threadRepository.setToolbarMessageId.mock.calls;
      expect(calls[0]).toEqual([threadChannelId, null]);
      expect(calls[1]).toEqual([threadChannelId, "sent-msg-1"]);
    });

    it("does not post a fresh toolbar if the thread is closed", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-msg-id",
        isClosed: true,
      });

      await service.foldReply(threadChannelId, { content: "x" } as any);

      expect(channel.send).not.toHaveBeenCalled();
    });

    it("falls back to a plain send if the toolbar message is already gone", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "already-gone",
        isClosed: false,
      });
      channel.messages.edit.mockRejectedValueOnce(
        new DiscordAPIError(
          { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
          RESTJSONErrorCodes.UnknownMessage,
          404,
          "PATCH",
          "url",
          {}
        )
      );
      const content = { content: "reply text" } as any;

      const folded = await service.foldReply(threadChannelId, content);

      expect(channel.send).toHaveBeenNthCalledWith(1, content);
      expect(folded.id).toBe("sent-msg-1");
    });

    it("throws if the channel is not text-based", async () => {
      channel.isTextBased.mockReturnValue(false);

      await expect(
        service.foldReply(threadChannelId, { content: "x" } as any)
      ).rejects.toThrow();
    });

    it("still returns the folded reply if posting the fresh toolbar afterward fails", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-msg-id",
        isClosed: false,
      });
      channel.send.mockRejectedValueOnce(new Error("rate limited"));
      const content = { content: "reply text" } as any;

      const folded = await service.foldReply(threadChannelId, content);

      // The fold itself (the edit) must not be lost just because the
      // best-effort repost afterward failed.
      expect(folded.id).toBe("edited-msg-id");
    });

    it("serializes overlapping folds for the same thread, so the second targets the toolbar the first just posted", async () => {
      // Stateful, unlike the other tests' static mocks -- this is the only
      // way to actually observe a race: a broken lock would let the second
      // fold read the pre-fold toolbarMessageId and edit the message the
      // first fold just turned into its reply, destroying it.
      let storedToolbarMessageId: string | null = "toolbar-msg-id";
      threadRepository.getThreadByChannelId.mockImplementation(async () => ({
        guildId,
        toolbarMessageId: storedToolbarMessageId,
        isClosed: false,
      }));
      threadRepository.setToolbarMessageId.mockImplementation(
        async (_channelId: string, messageId: string | null) => {
          storedToolbarMessageId = messageId;
        }
      );

      const editTargets: string[] = [];
      channel.messages.edit.mockImplementation(async (id: string) => {
        editTargets.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: `edited-${id}` };
      });

      await Promise.all([
        service.foldReply(threadChannelId, { content: "a" } as any),
        service.foldReply(threadChannelId, { content: "b" } as any),
      ]);

      // The second fold must target the fresh toolbar the first fold posted
      // ("sent-msg-1"), never the original "toolbar-msg-id" a second time.
      expect(editTargets).toEqual(["toolbar-msg-id", "sent-msg-1"]);
    });
  });

  describe("delete", () => {
    it("deletes the toolbar message and clears the stored ID", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "toolbar-to-remove",
      });

      await service.delete(threadChannelId);

      expect(channel.messages.delete).toHaveBeenCalledWith("toolbar-to-remove");
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        null
      );
    });

    it("does nothing if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.delete(threadChannelId);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(threadRepository.setToolbarMessageId).not.toHaveBeenCalled();
    });

    it("swallows an UnknownMessage error when deleting an already-gone toolbar", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "already-gone",
      });
      channel.messages.delete.mockRejectedValue(
        new DiscordAPIError(
          { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
          RESTJSONErrorCodes.UnknownMessage,
          404,
          "DELETE",
          "url",
          {}
        )
      );

      await expect(service.delete(threadChannelId)).resolves.toBeUndefined();
      expect(threadRepository.setToolbarMessageId).toHaveBeenCalledWith(
        threadChannelId,
        null
      );
    });
  });
});
