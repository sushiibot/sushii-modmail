import type { Message } from "discord.js";

export default abstract class TextCommandHandler {
  abstract readonly commandName: string;

  // Subcommand name - if this is defined, then commandName is the root command
  // name
  abstract readonly subCommandName: string | null;
  abstract readonly aliases: string[];

  abstract handler(msg: Message, args: string[]): Promise<void>;
}
