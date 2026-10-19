import { describe, it, expect } from "bun:test";
import { Collection, GuildMemberFlags } from "discord.js";
import { StaffThreadView } from "../../views/StaffThreadView";
import { HexColor } from "../../views/Color";

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;

function makeUser(ageMs: number) {
  return {
    id: "1",
    displayName: "User",
    username: "user",
    displayAvatarURL: () => "",
    createdTimestamp: now - ageMs,
  };
}

function makeMember(joinedAgoMs: number, rejoined = false) {
  return {
    roles: { cache: new Collection<string, { id: string; rawPosition: number }>() },
    joinedTimestamp: now - joinedAgoMs,
    flags: {
      has: (flag: GuildMemberFlags) =>
        rejoined && flag === GuildMemberFlags.DidRejoin,
    },
    nickname: null,
    avatarURL: () => null,
  };
}

describe("StaffThreadView.userWarnings", () => {
  it("returns no warnings for an established member", () => {
    const warnings = StaffThreadView.userWarnings(
      { user: makeUser(365 * DAY), member: makeMember(100 * DAY) },
      now
    );
    expect(warnings).toEqual([]);
  });

  it("flags a first-time member who joined recently", () => {
    const warnings = StaffThreadView.userWarnings(
      { user: makeUser(365 * DAY), member: makeMember(2 * DAY) },
      now
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("New member");
  });

  it("does not flag a recent join if the member has rejoined", () => {
    const warnings = StaffThreadView.userWarnings(
      { user: makeUser(365 * DAY), member: makeMember(2 * DAY, true) },
      now
    );
    expect(warnings).toEqual([]);
  });

  it("flags a new account", () => {
    const warnings = StaffThreadView.userWarnings(
      { user: makeUser(5 * DAY), member: makeMember(100 * DAY) },
      now
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("New account");
  });

  it("flags users who are not in the server", () => {
    const warnings = StaffThreadView.userWarnings(
      { user: makeUser(365 * DAY), member: null },
      now
    );
    expect(warnings).toEqual(["Not a member of this server"]);
  });
});

describe("StaffThreadView.userWarningsMessage", () => {
  it("renders each warning on its own line in a system message", () => {
    const msg = StaffThreadView.userWarningsMessage(["A", "B"]);
    const text = (msg.components![0] as any).toJSON().components[0].content;
    expect(text).toContain("### Staff only · Heads up");
    expect(text).toContain("⚠️ **A**\n⚠️ **B**");
  });
});

describe("StaffThreadView.systemMessage", () => {
  function render(audience: "user" | "staff") {
    const msg = StaffThreadView.systemMessage("hi", { audience, title: "T" });
    return (msg.components![0] as any).toJSON();
  }

  it("labels and colors messages sent to the user like staff replies", () => {
    const json = render("user");
    expect(json.components[0].content).toStartWith("### Sent to user · T");
    expect(json.accent_color).toBe(HexColor.Green);
  });

  it("labels staff-only notes in gray", () => {
    const json = render("staff");
    expect(json.components[0].content).toStartWith("### Staff only · T");
    expect(json.accent_color).toBe(HexColor.Gray);
  });
});
