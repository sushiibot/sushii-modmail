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

  beforeEach(() => {
    channel = {
      isSendable: mock().mockReturnValue(true),
      isTextBased: mock().mockReturnValue(true),
      send: mock().mockResolvedValue({ id: "new-toolbar-msg-id" }),
      messages: {
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

    service = new ToolbarService(client, snippetService, threadRepository, 20);
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
        "new-toolbar-msg-id"
      );
    });

    it("deletes the existing toolbar message before sending a new one", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-toolbar-msg-id",
        isClosed: false,
      });

      await service.send(threadChannelId);

      expect(channel.messages.delete).toHaveBeenCalledWith("old-toolbar-msg-id");
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("does nothing if the thread is closed (no reopen exists, so nothing should resurrect the toolbar)", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "old-toolbar-msg-id",
        isClosed: true,
      });

      await service.send(threadChannelId);

      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.messages.delete).not.toHaveBeenCalled();
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

    it("swallows an UnknownMessage error when deleting a stale toolbar", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue({
        guildId,
        toolbarMessageId: "already-gone",
        isClosed: false,
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

      await expect(service.send(threadChannelId)).resolves.toBeUndefined();
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("does nothing if the channel is not sendable", async () => {
      channel.isSendable.mockReturnValue(false);

      await service.send(threadChannelId);

      expect(threadRepository.setToolbarMessageId).not.toHaveBeenCalled();
    });
  });

  describe("scheduleResend", () => {
    it("debounces multiple calls into a single send", async () => {
      service.scheduleResend(threadChannelId);
      service.scheduleResend(threadChannelId);
      service.scheduleResend(threadChannelId);

      // Nothing should have fired yet -- still within the debounce window.
      expect(channel.send).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("fires again for a second burst after the first one resolves", async () => {
      service.scheduleResend(threadChannelId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(channel.send).toHaveBeenCalledTimes(1);

      service.scheduleResend(threadChannelId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(channel.send).toHaveBeenCalledTimes(2);
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

    it("cancels a pending scheduled resend", async () => {
      service.scheduleResend(threadChannelId);
      await service.delete(threadChannelId);

      // Wait past when the debounced send would have fired.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // delete() itself calls send-equivalent cleanup, not a full send --
      // channel.send should never be invoked by the cancelled timer.
      expect(channel.send).not.toHaveBeenCalled();
    });

    it("does nothing if the thread doesn't exist", async () => {
      threadRepository.getThreadByChannelId.mockResolvedValue(null);

      await service.delete(threadChannelId);

      expect(channel.messages.delete).not.toHaveBeenCalled();
      expect(threadRepository.setToolbarMessageId).not.toHaveBeenCalled();
    });
  });
});
