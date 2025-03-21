import type { Message } from "discord.js";

export default abstract class TextCommandHandler {
  abstract readonly name: string;
  abstract readonly aliases: string[];

  abstract handler(msg: Message, args: string[]): Promise<void>;
}
