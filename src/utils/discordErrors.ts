import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

// Not in discord-api-types' RESTJSONErrorCodes.
export const CANNOT_SEND_MESSAGES_NO_MUTUAL_GUILDS = 50278;

export type UndeliverableDMReason = "dms_blocked" | "no_mutual_guilds";

/**
 * Returns why a DM can't be delivered to the user, or null if the error is
 * not a "can't DM this user" error.
 */
export function getUndeliverableDMReason(
  err: unknown
): UndeliverableDMReason | null {
  if (!(err instanceof DiscordAPIError)) {
    return null;
  }

  if (err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) {
    return "dms_blocked";
  }

  if (err.code === CANNOT_SEND_MESSAGES_NO_MUTUAL_GUILDS) {
    return "no_mutual_guilds";
  }

  return null;
}

export function isUndeliverableDMError(err: unknown): boolean {
  return getUndeliverableDMReason(err) !== null;
}
