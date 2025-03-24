import { Message } from "discord.js";
import type TextCommandHandler from "./commands/CommandHandler";
import parentLogger from "./utils/logger";
import type { Logger } from "pino";

interface Config {
  prefix: string;
}

export default class CommandRouter {
  config: Config;
  commands: Map<string, TextCommandHandler>;
  logger: Logger;

  constructor(config: Config, commands?: TextCommandHandler[]) {
    this.config = config;
    this.commands = new Map();
    this.logger = parentLogger.child({ module: "CommandRouter" });

    if (commands) {
      this.addCommands(...commands);
    }
  }

  addCommands(...commands: TextCommandHandler[]) {
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];

      if (this.commands.has(c.name)) {
        throw new Error(
          `Command name attempted to be registered twice: ${c.name}`
        );
      }

      // Set base name handler
      this.commands.set(c.name, c);

      // Set aliases
      for (let j = 0; j < c.aliases.length; j++) {
        const alias = c.aliases[j];

        if (this.commands.has(alias)) {
          throw new Error(
            `Command alias attempted to be registered twice: ${alias}`
          );
        }

        this.commands.set(alias, c);
      }
    }
  }

  async getPrefix(msg: Message): Promise<string> {
    return this.config.prefix;
  }

  async isCommand(msg: Message): Promise<boolean> {
    const prefix = await this.getPrefix(msg);
    return msg.content.startsWith(prefix);
  }

  async breakDownMessage(
    contentWithoutPrefix: string
  ): Promise<[string, string[]]> {
    const content = contentWithoutPrefix.trim();

    const contentArray = content.split(" ");
    const commandName = contentArray[0].toLowerCase();

    const args = contentArray.slice(1);

    return [commandName, args];
  }

  async handleMessage(msg: Message) {
    if (!(await this.isCommand(msg))) {
      return;
    }

    const [commandName, args] = await this.breakDownMessage(
      msg.content.slice(1)
    );

    const command = this.commands.get(commandName);
    if (!command) {
      this.logger.warn(
        `Command not found: ${commandName}, ignoring. Please register the command with CommandRouter.`
      );
      return;
    }

    try {
      await command.handler(msg, args);
    } catch (error) {
      this.logger.error(error, `Error handling command: ${commandName}`);
    }
  }
}
