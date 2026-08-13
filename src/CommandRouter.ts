import { Message, PermissionsBitField } from "discord.js";
import type TextCommandHandler from "./commands/CommandHandler";
import parentLogger from "./utils/logger";
import type { Logger } from "pino";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import type { BotConfig } from "models/botConfig.model";
import { CommandErrorView } from "views/CommandErrorView";
import { withSpan } from "./tracing";

interface CommandEntry {
  handler: TextCommandHandler | null;

  // Only support 1 level of subcommands
  subcommands: Map<string, TextCommandHandler>;
}

interface RuntimeConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
}

export default class CommandRouter {
  commands: Map<string, CommandEntry>;
  logger: Logger;

  private runtimeConfigRepository: RuntimeConfigRepository;
  private config: BotConfig;

  // Discord sends nickname mentions as <@!id> for older clients, plain <@id> otherwise
  private readonly mentionPrefixRegex: RegExp;

  // Text-prefix commands are being deprecated in favor of @mention triggers
  // (message content isn't reliably available without the privileged intent
  // unless the message mentions the bot). Warn at most once a day per guild
  // so the notice doesn't spam a busy thread.
  private static readonly PREFIX_DEPRECATION_WARNING_INTERVAL_MS =
    24 * 60 * 60 * 1000;
  private lastPrefixDeprecationWarningAtByGuild = new Map<string, number>();

  constructor(
    runtimeConfigRepository: RuntimeConfigRepository,
    config: BotConfig,
    commands?: TextCommandHandler[]
  ) {
    this.runtimeConfigRepository = runtimeConfigRepository;
    this.config = config;
    this.mentionPrefixRegex = new RegExp(
      `^<@!?${config.discordClientId}>\\s*`
    );

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

  async getPrefix(msg: Message<true>): Promise<string> {
    const config = await this.runtimeConfigRepository.getConfig(msg.guildId);

    return config.prefix;
  }

  /**
   * Matches either the configured text prefix or an @mention of the bot,
   * returning the message content with that prefix stripped off, along with
   * which form matched, or null if the message doesn't start with either.
   */
  async stripPrefixDetailed(
    msg: Message<true>
  ): Promise<{ content: string; viaMention: boolean } | null> {
    const mentionMatch = msg.content.match(this.mentionPrefixRegex);
    if (mentionMatch) {
      return {
        content: msg.content.slice(mentionMatch[0].length),
        viaMention: true,
      };
    }

    const prefix = await this.getPrefix(msg);
    if (msg.content.startsWith(prefix)) {
      return {
        content: msg.content.slice(prefix.length),
        viaMention: false,
      };
    }

    return null;
  }

  async stripPrefix(msg: Message<true>): Promise<string | null> {
    const result = await this.stripPrefixDetailed(msg);
    return result?.content ?? null;
  }

  async isCommand(msg: Message<true>): Promise<boolean> {
    return (await this.stripPrefix(msg)) !== null;
  }

  /**
   * Sends a rate-limited (at most once/day per guild, in-memory) reminder
   * that text-prefix commands are deprecated in favor of @mentioning the
   * bot. Only fires for messages that resolved to an actual known command,
   * not every message that happens to start with the prefix character.
   */
  private warnAboutPrefixUsage(msg: Message<true>): void {
    const now = Date.now();
    const lastWarnedAt =
      this.lastPrefixDeprecationWarningAtByGuild.get(msg.guildId) ?? 0;

    if (
      now - lastWarnedAt <
      CommandRouter.PREFIX_DEPRECATION_WARNING_INTERVAL_MS
    ) {
      return;
    }
    this.lastPrefixDeprecationWarningAtByGuild.set(msg.guildId, now);

    msg.channel
      .send(
        CommandErrorView.prefixDeprecationWarning(
          this.config.discordClientId,
          this.config.ownerUserId
        )
      )
      .catch((error) =>
        this.logger.warn(error, "Failed to send prefix deprecation warning")
      );
  }

  async breakDownMessage(
    contentWithoutPrefix: string
  ): Promise<[string, string | null, string[]]> {
    const content = contentWithoutPrefix.trim();

    // Split on any run of whitespace (spaces or tabs) and drop empty tokens,
    // so repeated/irregular spacing doesn't produce blank args (previously
    // e.g. "logs  123" resolved args[0] to "" instead of "123").
    const contentArray = content.split(/\s+/).filter((s) => s.length > 0);
    const commandName = (contentArray[0] ?? "").toLowerCase();

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

  async hasPermission(msg: Message): Promise<boolean> {
    if (!msg.inGuild() || !msg.member) {
      return false;
    }

    const runtimeConfig = await this.runtimeConfigRepository.getConfig(
      msg.guildId
    );

    // Server managers always have permission
    if (msg.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return true;
    }

    // If no roles set, default requirement is Moderate Members permission
    if (runtimeConfig.requiredRoleIds.length === 0) {
      return msg.member.permissions.has(
        PermissionsBitField.Flags.ModerateMembers
      );
    }

    // Check if user has ANY of the required roles
    for (const roleId of runtimeConfig.requiredRoleIds) {
      if (msg.member.roles.cache.has(roleId)) {
        return true;
      }
    }

    this.logger.debug(
      {
        userId: msg.author.id,
        guildId: msg.guildId,
        requiredRoleIds: runtimeConfig.requiredRoleIds,
        userRoles: msg.member.roles.cache.map((r) => r.id),
      },
      `User does not have required role to use commands`
    );

    return false;
  }

  async handleMessage(msg: Message) {
    if (msg.author.bot) {
      return;
    }

    if (!msg.inGuild() || !msg.member) {
      return;
    }

    const prefixMatch = await this.stripPrefixDetailed(msg);
    if (prefixMatch === null) {
      return;
    }

    const [commandName, subCommandName, args] = await this.breakDownMessage(
      prefixMatch.content
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

    if (handler.ownerOnly) {
      // Owner-only commands respond only to an @mention trigger -- this
      // both dedupes to exactly one bot in a multi-bot guild (the mention
      // regex is built from this bot's own discordClientId) and skips
      // getPrefix()/runtimeConfigRepository.getConfig() entirely, so it
      // can never throw GuildOwnershipConflictError the way a text-prefix
      // invocation on a non-owning bot would.
      if (!prefixMatch.viaMention) {
        return;
      }

      if (msg.author.id !== this.config.ownerUserId) {
        return;
      }
    } else {
      const hasPermission = await this.hasPermission(msg);
      if (!hasPermission) {
        return;
      }

      if (!prefixMatch.viaMention) {
        this.warnAboutPrefixUsage(msg);
      }
    }

    // Check if command requires primary server validation
    if (handler.requiresPrimaryServer && msg.guildId !== this.config.guildId) {
      const guild = msg.client.guilds.cache.get(this.config.guildId);
      const name = guild?.name ?? "Unknown Server";

      const errorMessage = CommandErrorView.primaryServerOnlyError(
        name,
        this.config.guildId
      );
      await msg.channel.send(errorMessage);

      return;
    }

    try {
      await withSpan(
        "command.handle",
        {
          "command.name": commandName,
          ...(subCommandName ? { "command.subcommand": subCommandName } : {}),
        },
        () => handler.handler(msg, args)
      );
    } catch (error) {
      this.logger.error(
        error,
        `Error handling command: ${commandName} ${subCommandName}`
      );
    }
  }
}
