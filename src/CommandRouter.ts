import { Message, PermissionsBitField } from "discord.js";
import type TextCommandHandler from "./commands/CommandHandler";
import parentLogger from "./utils/logger";
import type { Logger } from "pino";

interface Config {
  prefix: string;
  requiredRoleId: string;
}

interface CommandEntry {
  handler: TextCommandHandler | null;

  // Only support 1 level of subcommands
  subcommands: Map<string, TextCommandHandler>;
}

export default class CommandRouter {
  config: Config;
  commands: Map<string, CommandEntry>;
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
    for (const command of commands) {
      if (command.subCommandName === null) {
        // This is a base command
        if (this.commands.has(command.commandName)) {
          throw new Error(
            `Duplicate command registered: ${command.commandName}`
          );
        }

        this.commands.set(command.commandName, {
          handler: command,
          subcommands: new Map(),
        });

        // Register aliases
        for (const alias of command.aliases) {
          if (this.commands.has(alias)) {
            throw new Error(
              `Duplicate command alias registered for command ${command.commandName}: ${alias}`
            );
          }

          this.commands.set(alias, {
            handler: command,
            subcommands: new Map(),
          });
        }

        continue;
      }

      // Add subcommand
      if (!this.commands.has(command.commandName)) {
        // Create parent command entry if it doesn't exist
        this.commands.set(command.commandName, {
          handler: null,
          subcommands: new Map(),
        });
      }

      const parentEntry = this.commands.get(command.commandName)!;

      if (parentEntry.subcommands.get(command.subCommandName)) {
        throw new Error(
          `Duplicate subcommand registered: ${command.commandName} ${command.subCommandName}`
        );
      }

      parentEntry.subcommands.set(command.subCommandName, command);

      // Register aliases
      for (const alias of command.aliases) {
        parentEntry.subcommands.set(alias, command);
      }
    }
  }

  getCommandNames(): Set<string> {
    // Create a set for uniqueness
    const commandNames = new Set<string>();

    // Iterate through all commands
    for (const [name, entry] of this.commands.entries()) {
      // Include all command names and aliases that have a handler
      if (entry.handler) {
        commandNames.add(name);
      }
    }

    return commandNames;
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
  ): Promise<[string, string | null, string[]]> {
    const content = contentWithoutPrefix.trim();

    const contentArray = content.split(" ");
    const commandName = contentArray[0].toLowerCase();

    // Check if there's a potential subcommand
    let subCommandName: string | null = null;
    let args: string[] = [];

    if (contentArray.length > 1) {
      // Check if we have a valid subcommand
      const potentialCommand = this.commands.get(commandName);

      if (
        potentialCommand &&
        potentialCommand.subcommands.has(contentArray[1].toLowerCase())
      ) {
        // This is a main command that can have subcommands
        subCommandName = contentArray[1].toLowerCase();
        args = contentArray.slice(2);
      } else {
        // No subcommand
        args = contentArray.slice(1);
      }
    } else {
      args = [];
    }

    return [commandName, subCommandName, args];
  }

  async handleMessage(msg: Message) {
    if (msg.author.bot) {
      return;
    }

    if (!msg.inGuild() || !msg.member) {
      return;
    }

    if (!(await this.isCommand(msg))) {
      return;
    }

    // Check if user has required role
    if (!msg.member.roles.cache.has(this.config.requiredRoleId)) {
      return;
    }

    const [commandName, subCommandName, args] = await this.breakDownMessage(
      msg.content.slice(1)
    );

    let rootCommand = this.commands.get(commandName);

    // No matching command
    if (!rootCommand) {
      return;
    }

    let handler: TextCommandHandler | null;

    // Subcommand found, use subcommand handler
    if (subCommandName) {
      const subcommand = rootCommand.subcommands.get(subCommandName);

      if (!subcommand) {
        this.logger.warn(
          `Subcommand not found: ${commandName} ${subCommandName}`
        );
        return;
      }

      handler = subcommand;
    } else {
      // No subcommand, use root sub-command
      handler = rootCommand.handler;
    }

    if (!handler) {
      this.logger.warn(
        `Command handler not found: ${rootCommand} ${subCommandName}`
      );

      return;
    }

    try {
      await handler.handler(msg, args);
    } catch (error) {
      this.logger.error(
        error,
        `Error handling command: ${commandName} ${subCommandName}`
      );
    }
  }
}
