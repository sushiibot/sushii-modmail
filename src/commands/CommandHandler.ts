import type { Message } from "discord.js";

export default abstract class TextCommandHandler {
  abstract readonly commandName: string;

  // Subcommand name - if this is defined, then commandName is the root command
  // name
  abstract readonly subCommandName: string | null;
  abstract readonly aliases: string[];

  // Whether this command requires execution in the primary server only
  abstract readonly requiresPrimaryServer: boolean;

  // Owner-only commands (e.g. `bot add/reload/remove/rotate`) only respond
  // to an @mention trigger, never the text prefix, and are gated on
  // config.ownerUserId instead of guild role permissions -- see
  // CommandRouter.handleMessage. Optional (not defaulted) so existing
  // command classes and test mocks don't need updating.
  readonly ownerOnly?: boolean;

  // rawArgs is the free-text portion of the message after the command (and
  // subcommand, if any) name, with original whitespace/newlines intact --
  // use this instead of args.join(" ") when a command needs to preserve
  // line breaks (e.g. reply/edit/close reason text).
  abstract handler(
    msg: Message,
    args: string[],
    rawArgs: string
  ): Promise<void>;
}
