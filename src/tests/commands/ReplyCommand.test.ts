import { describe, expect, it, mock } from "bun:test";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { ReplyCommand } from "../../commands/reply/ReplyCommand";

function fixture() {
  const relay = mock().mockResolvedValue(undefined);
  const bump = mock().mockResolvedValue(undefined);
  const send = mock().mockResolvedValue(undefined);
  const remove = mock().mockResolvedValue(undefined);
  const logger = { error: mock(), warn: mock() };
  const command = new ReplyCommand(
    { getThreadByChannelId: mock().mockResolvedValue({ userId: "user-1", isClosed: false }) } as any,
    { relayStaffMessageToUser: relay, bumpToolbarToBottom: bump } as any,
    { getConfig: mock().mockResolvedValue({ forumChannelId: "forum-1" }) }
  );
  (command as any).logger = logger;
  const msg = {
    id: "message-1",
    content: "!reply private staff reply",
    inGuild: () => true,
    guildId: "guild-1",
    guild: {},
    channelId: "channel-1",
    channel: { id: "channel-1", parentId: "forum-1", send },
    author: { id: "staff-1" },
    attachments: new Map(),
    stickers: new Map(),
    createdTimestamp: 1,
    delete: remove,
  } as any;
  return { command, msg, relay, bump, send, remove, logger };
}

function missingPermissions() {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.MissingPermissions, message: "Missing Permissions" },
    RESTJSONErrorCodes.MissingPermissions, 403, "DELETE", "https://discord.com/api/messages/1", {}
  );
}

describe("reply command cleanup", () => {
  it("does not report a delivery failure when deletion and its warning both fail", async () => {
    const f = fixture();
    f.remove.mockRejectedValue(missingPermissions());
    f.send.mockRejectedValue(missingPermissions());
    await f.command.handler(f.msg, [], "private staff reply");
    expect(f.relay).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]![0]).toContain("Manage Messages");
    expect(f.bump).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain("private staff reply");
  });

  it("does not log staff content even if a cleanup error contains it", async () => {
    const f = fixture();
    f.remove.mockRejectedValue(new Error(f.msg.content));
    await f.command.handler(f.msg, [], "private staff reply");
    expect(f.logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain("private staff reply");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.relay).toHaveBeenCalledTimes(1);
  });

  it("retains the command and reports an actual delivery failure", async () => {
    const f = fixture();
    f.relay.mockRejectedValue(new Error("delivery unavailable"));
    await f.command.handler(f.msg, [], "private staff reply");
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledWith("Error while sending reply. See logs for details.");
    expect(f.bump).toHaveBeenCalledTimes(1);
  });

  it("deletes the command after successful delivery", async () => {
    const f = fixture();
    await f.command.handler(f.msg, [], "private staff reply");
    expect(f.relay).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.logger.warn).not.toHaveBeenCalled();
  });
});
