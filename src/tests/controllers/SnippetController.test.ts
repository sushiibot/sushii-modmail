import { beforeEach, describe, expect, it, mock } from "bun:test";
import { SnippetController } from "../../controllers/SnippetController";

const CLIENT_ID = "999999999999999999";

function mockMessage(content: string) {
  return {
    content,
    author: { bot: false, id: "staff-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    createdTimestamp: 123,
    inGuild: () => true,
    channel: { id: "channel-1", parentId: "forum-1", isThread: () => true },
    mentions: { roles: { first: () => undefined }, users: { first: () => undefined } },
    attachments: new Map(),
    stickers: new Map(),
    delete: mock().mockResolvedValue(undefined),
    reply: mock().mockResolvedValue(undefined),
  } as any;
}

describe("SnippetController -p flag", () => {
  let snippetService: any;
  let messageService: any;
  let controller: SnippetController;
  const client = { guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) } } as any;

  beforeEach(() => {
    snippetService = {
      getSnippet: mock(async (_guildId: string, name: string) => ({
        guildId: "guild-1",
        name,
        content: `content for ${name}`,
      })),
    };
    messageService = {
      relayStaffMessageToUser: mock().mockResolvedValue(undefined),
    };
    controller = new SnippetController(
      snippetService,
      {
        getThreadByChannelId: mock().mockResolvedValue({
          userId: "user-1",
          channelId: "channel-1",
          guildId: "guild-1",
        }),
      },
      messageService,
      {
        getConfig: mock().mockResolvedValue({
          prefix: "-",
          forumChannelId: "forum-1",
          anonymousSnippets: false,
        }),
      } as any,
      CLIENT_ID
    );
  });

  async function send(content: string) {
    const handled = await controller.handleThreadMessage(client, mockMessage(content));
    expect(handled).toBe(true);
    const [, , , , options] = messageService.relayStaffMessageToUser.mock.calls[0];
    return { name: snippetService.getSnippet.mock.calls[0][1], options };
  }

  it("does not treat the default prefix of a name starting with p as the flag", async () => {
    const { name, options } = await send("-ping");
    expect(name).toBe("ping");
    expect(options.plainText).toBe(false);
  });

  it("sends plain text with a standalone -p after the name", async () => {
    const { name, options } = await send("-greeting -p");
    expect(name).toBe("greeting");
    expect(options.plainText).toBe(true);
  });

  it("does not treat -p inside the snippet name as the flag", async () => {
    const { name, options } = await send("-help-page");
    expect(name).toBe("help-page");
    expect(options.plainText).toBe(false);
  });

  it("detects the flag after a mention-triggered snippet name", async () => {
    const { name, options } = await send(`<@${CLIENT_ID}> greeting -p`);
    expect(name).toBe("greeting");
    expect(options.plainText).toBe(true);
  });
});
