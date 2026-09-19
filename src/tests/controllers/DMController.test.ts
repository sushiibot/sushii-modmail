import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ChannelType } from "discord.js";
import { DMController } from "../../controllers/DMController";
import { randomSnowflakeID } from "tests/utils/snowflake";

function mockDMMessage(overrides: Partial<{ authorId: string; bot: boolean }> = {}) {
  return {
    id: randomSnowflakeID(),
    channel: { type: ChannelType.DM },
    author: {
      id: overrides.authorId ?? randomSnowflakeID(),
      bot: overrides.bot ?? false,
      username: "user",
      tag: "user#0000",
    },
    messageSnapshots: { size: 0, first: () => undefined },
    attachments: { values: () => [] },
    stickers: { values: () => [] },
    content: "hello staff",
    react: mock().mockResolvedValue(undefined),
  } as any;
}

describe("DMController", () => {
  let threadService: any;
  let messageService: any;
  let logService: any;
  let controller: DMController;

  const channelId = randomSnowflakeID();

  beforeEach(() => {
    threadService = {
      getOrCreateThread: mock(),
      getThread: mock(),
    };
    messageService = {
      relayUserMessageToStaff: mock().mockResolvedValue(true),
      relayUserEditedMessageToStaff: mock(),
      relayUserDeletedMessageToStaff: mock(),
      sendInitialMessageToUser: mock().mockResolvedValue("welcome content"),
      sendInitialMessageToStaff: mock().mockResolvedValue(undefined),
      bumpToolbarToBottom: mock().mockResolvedValue(undefined),
    };
    logService = { logError: mock() };

    controller = new DMController(threadService, messageService, logService);
  });

  describe("handleUserDM", () => {
    it("bumps the toolbar to the bottom after the initial notice, only for a new thread", async () => {
      threadService.getOrCreateThread.mockResolvedValue({
        thread: { channelId },
        isNew: true,
      });
      const message = mockDMMessage();

      await controller.handleUserDM({} as any, message);

      expect(messageService.sendInitialMessageToStaff).toHaveBeenCalledWith(
        channelId,
        "welcome content"
      );
      expect(messageService.bumpToolbarToBottom).toHaveBeenCalledWith(channelId);

      // The initial-notice send must land, and only then the bump --
      // never the other way around, or the notice would strand the
      // toolbar again right after it was moved.
      const staffCallOrder =
        messageService.sendInitialMessageToStaff.mock.invocationCallOrder[0];
      const bumpCallOrder =
        messageService.bumpToolbarToBottom.mock.invocationCallOrder[0];
      expect(staffCallOrder).toBeLessThan(bumpCallOrder);
    });

    it("does not bump the toolbar for an existing thread", async () => {
      threadService.getOrCreateThread.mockResolvedValue({
        thread: { channelId },
        isNew: false,
      });
      const message = mockDMMessage();

      await controller.handleUserDM({} as any, message);

      expect(messageService.sendInitialMessageToStaff).not.toHaveBeenCalled();
      expect(messageService.bumpToolbarToBottom).not.toHaveBeenCalled();
    });

    it("does not react or bump if the relay failed", async () => {
      threadService.getOrCreateThread.mockResolvedValue({
        thread: { channelId },
        isNew: true,
      });
      messageService.relayUserMessageToStaff.mockResolvedValue(false);
      const message = mockDMMessage();

      await controller.handleUserDM({} as any, message);

      expect(message.react).not.toHaveBeenCalled();
      expect(messageService.sendInitialMessageToStaff).not.toHaveBeenCalled();
      expect(messageService.bumpToolbarToBottom).not.toHaveBeenCalled();
    });
  });
});
