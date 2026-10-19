import { describe, expect, it, mock } from "bun:test";
import { CloseCommand } from "../../commands/CloseCommand";
import { LogsCommand } from "../../commands/LogsCommand";
import {
  NOT_CONFIGURED_MESSAGE,
  THREAD_NOT_FOUND_MESSAGE,
} from "../../views/CommandErrorView";

function mockThreadMessage() {
  const send = mock(() => Promise.resolve());
  return {
    send,
    msg: {
      inGuild: () => true,
      guildId: "guild-1",
      channel: {
        id: "channel-1",
        parentId: "forum-1",
        isThread: () => true,
        send,
      },
    } as any,
  };
}

function configRepository(forumChannelId: string | null) {
  return { getConfig: mock().mockResolvedValue({ forumChannelId }) };
}

const threadService = {
  getThreadByChannelId: mock().mockResolvedValue(null),
} as any;

describe("shared command error messages", () => {
  it("close and logs send the same thread-not-found message", async () => {
    for (const command of [
      new CloseCommand(threadService, configRepository("forum-1")),
      new LogsCommand(threadService, {} as any, configRepository("forum-1")),
    ]) {
      const { msg, send } = mockThreadMessage();
      await command.handler(msg, [], "");
      expect(send).toHaveBeenCalledWith(THREAD_NOT_FOUND_MESSAGE);
    }
  });

  it("close and logs send the same not-configured message", async () => {
    for (const command of [
      new CloseCommand(threadService, configRepository(null)),
      new LogsCommand(threadService, {} as any, configRepository(null)),
    ]) {
      const { msg, send } = mockThreadMessage();
      await command.handler(msg, [], "");
      expect(send).toHaveBeenCalledWith(NOT_CONFIGURED_MESSAGE);
    }
  });
});
