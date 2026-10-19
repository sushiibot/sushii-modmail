import { beforeEach, describe, expect, it, mock } from "bun:test";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { ContactCommand } from "../../commands/ContactCommand";

const TARGET_ID = "123456789012345678";

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    404,
    "GET",
    "url",
    {}
  );
}

describe("ContactCommand", () => {
  let threadService: any;
  let fetchUser: ReturnType<typeof mock>;
  let send: ReturnType<typeof mock>;
  let msg: any;
  let command: ContactCommand;

  beforeEach(() => {
    threadService = {
      getOrCreateThread: mock(() =>
        Promise.resolve({ thread: { link: "https://thread" }, isNew: true })
      ),
    };
    fetchUser = mock(() =>
      Promise.resolve({ id: TARGET_ID, username: "target", bot: false })
    );
    send = mock(() => Promise.resolve());
    msg = {
      inGuild: () => true,
      channel: { send },
      client: { users: { fetch: fetchUser } },
      // The bot's own @mention prefix shows up in msg.mentions
      mentions: { users: { first: () => ({ id: "999", bot: true }) } },
    };
    command = new ContactCommand(threadService, {} as any);
  });

  it("sends usage and does not fetch with no args", async () => {
    await command.handler(msg, []);

    expect(send).toHaveBeenCalledWith("Usage: contact <@user | user ID>");
    expect(fetchUser).not.toHaveBeenCalled();
    expect(threadService.getOrCreateThread).not.toHaveBeenCalled();
  });

  it("sends usage for a non-ID argument", async () => {
    await command.handler(msg, ["abc"]);

    expect(send).toHaveBeenCalledWith("Usage: contact <@user | user ID>");
    expect(threadService.getOrCreateThread).not.toHaveBeenCalled();
  });

  it("reports an unknown user", async () => {
    fetchUser.mockImplementation(() =>
      Promise.reject(apiError(RESTJSONErrorCodes.UnknownUser))
    );

    await command.handler(msg, [TARGET_ID]);

    expect(send).toHaveBeenCalledWith("Could not find a user with that ID.");
    expect(threadService.getOrCreateThread).not.toHaveBeenCalled();
  });

  it("does not open a thread with a bot", async () => {
    fetchUser.mockImplementation(() =>
      Promise.resolve({ id: TARGET_ID, username: "abot", bot: true })
    );

    await command.handler(msg, [TARGET_ID]);

    expect(send).toHaveBeenCalledWith("You cannot open a thread with a bot.");
    expect(threadService.getOrCreateThread).not.toHaveBeenCalled();
  });

  it("uses args[0] rather than the bot's own mention", async () => {
    await command.handler(msg, [`<@!${TARGET_ID}>`]);

    expect(fetchUser).toHaveBeenCalledWith(TARGET_ID);
    expect(threadService.getOrCreateThread).toHaveBeenCalledWith(
      TARGET_ID,
      "target",
      true,
      "staff_contact"
    );
    expect(send).toHaveBeenCalledWith("Created a new thread: https://thread");
  });
});
