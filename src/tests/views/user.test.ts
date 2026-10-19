import { describe, it, expect } from "bun:test";
import { formatUserIdentity } from "../../views/user";
import { UserThreadView } from "../../views/UserThreadView";
import type { StaffToUserMessage } from "../../models/relayMessage";

describe("formatUserIdentity", () => {
  it("returns username with id when no nickname", () => {
    const result = formatUserIdentity("123", "ExampleUser");
    expect(result).toBe("ExampleUser (ID: 123)");
  });

  it("includes nickname when provided", () => {
    const result = formatUserIdentity("123", "ExampleUser", "Nick");
    expect(result).toBe("Nick ~ ExampleUser (ID: 123)");
  });
});

describe("UserThreadView.staffMessage (plain text)", () => {
  const guild = { name: "Test Guild", iconURL: () => null };
  const plain = {
    anonymous: false,
    plainText: true,
    snippet: false,
  };

  function makeMsg(overrides: Partial<StaffToUserMessage> = {}) {
    return {
      id: "1",
      author: {
        id: "2",
        displayName: "Staff",
        username: "staffuser",
        displayAvatarURL: () => "",
      },
      content: "hello",
      attachments: [],
      stickers: [],
      createdTimestamp: 0,
      ...overrides,
    } satisfies StaffToUserMessage;
  }

  it("includes the header with the staff username and content", async () => {
    const result = await UserThreadView.staffMessage(guild, makeMsg(), plain);

    expect(result.content).toBe(
      "### Message from Test Guild - staffuser\nhello"
    );
  });

  it("anonymous header has no stray bold marker or username", async () => {
    const result = await UserThreadView.staffMessage(guild, makeMsg(), {
      ...plain,
      anonymous: true,
    });

    expect(result.content).toBe("### Message from Test Guild\nhello");
  });

  it("attachment-only reply produces non-empty content with links", async () => {
    const result = await UserThreadView.staffMessage(
      guild,
      makeMsg({
        content: "",
        attachments: [{ name: "a.png", url: "https://cdn.example/a.png" }],
      }),
      plain
    );

    expect(result.content).toContain("[a.png](https://cdn.example/a.png)");
    expect(result.content).not.toContain("\nhello");
  });

  it("lists stickers", async () => {
    const result = await UserThreadView.staffMessage(
      guild,
      makeMsg({
        stickers: [{ name: "wave", url: "https://cdn.example/s.png" }],
      }),
      plain
    );

    expect(result.content).toContain("#### Stickers");
    expect(result.content).toContain("[wave](https://cdn.example/s.png)");
  });
});
