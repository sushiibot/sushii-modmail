import type { Message } from "discord.js";

export default abstract class TextCommandHandler {
  abstract readonly name: string;
  abstract readonly aliases: string[];

  /**
   * Field for the actual handler function
   */
  abstract handler(msg: Message, args: string[]): Promise<void>;
}
