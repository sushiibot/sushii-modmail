import type { Message } from "discord.js";

/**
 * A bot's managed role shares the bot's name, so picking "@Bot" from
 * autocomplete can produce a role mention instead of a user mention.
 */
export function matchBotRoleMention(msg: Message): RegExpMatchArray | null {
  const botRoleId = msg.guild?.members?.me?.roles?.botRole?.id;
  if (!botRoleId) {
    return null;
  }

  return msg.content.match(new RegExp(`^<@&${botRoleId}>\\s*`));
}
