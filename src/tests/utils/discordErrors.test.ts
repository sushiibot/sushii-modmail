import { describe, expect, it } from "bun:test";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import {
  CANNOT_SEND_MESSAGES_NO_MUTUAL_GUILDS,
  getUndeliverableDMReason,
  isUndeliverableDMError,
} from "utils/discordErrors";
import { classifyDiscordError } from "utils/metrics";

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    403,
    "POST",
    "url",
    {}
  );
}

describe("getUndeliverableDMReason", () => {
  it("maps 50007 to dms_blocked", () => {
    const err = apiError(RESTJSONErrorCodes.CannotSendMessagesToThisUser);
    expect(getUndeliverableDMReason(err)).toBe("dms_blocked");
    expect(isUndeliverableDMError(err)).toBe(true);
  });

  it("maps 50278 to no_mutual_guilds", () => {
    const err = apiError(CANNOT_SEND_MESSAGES_NO_MUTUAL_GUILDS);
    expect(getUndeliverableDMReason(err)).toBe("no_mutual_guilds");
    expect(isUndeliverableDMError(err)).toBe(true);
  });

  it("returns null for other errors", () => {
    expect(getUndeliverableDMReason(apiError(RESTJSONErrorCodes.UnknownChannel))).toBeNull();
    expect(getUndeliverableDMReason(new Error("boom"))).toBeNull();
    expect(isUndeliverableDMError(undefined)).toBe(false);
  });
});

describe("classifyDiscordError", () => {
  it("classifies 50007 and 50278 as dm_blocked", () => {
    expect(
      classifyDiscordError(apiError(RESTJSONErrorCodes.CannotSendMessagesToThisUser))
    ).toBe("dm_blocked");
    expect(
      classifyDiscordError(apiError(CANNOT_SEND_MESSAGES_NO_MUTUAL_GUILDS))
    ).toBe("dm_blocked");
  });
});
