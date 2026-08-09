import { Client, GatewayIntentBits, Options, Partials } from "discord.js";
import type { DB } from "database/db";
import type { BotRosterEntry } from "repositories/bot.repository";
import { BotConfig, type GlobalConfig } from "models/botConfig.model";
import { registerEventHandlers } from "../events";
import CommandRouter from "../CommandRouter";
import { ThreadRepository } from "repositories/thread.repository";
import { SnippetRepository } from "repositories/snippet.repository";
import { RuntimeConfigRepository } from "repositories/runtimeConfig.repository";
import { MessageRepository } from "repositories/message.repository";
import { BotEmojiRepository } from "repositories/botEmoji.repository";
import { ThreadService } from "./ThreadService";
import { MessageRelayService } from "./MessageRelayService";
import { SnippetService } from "./SnippetService";
import { SettingsService } from "./SettingsService";
import { SayService } from "./SayService";
import { ReplyCommand } from "commands/reply/ReplyCommand";
import { AnonymousReplyCommand } from "commands/reply/AnonymousReplyCommand";
import { AnonymousPlainReplyCommand } from "commands/reply/AnonymousPlainReplyCommand";
import { PlainReplyCommand } from "commands/reply/PlainReplyCommand";
import { EditCommand } from "commands/EditCommand";
import { DeleteCommand } from "commands/DeleteCommand";
import { GetSnippetCommand } from "commands/snippets/GetSnippetCommand";
import { AddSnippetCommand } from "commands/snippets/AddSnippetCommand";
import { EditSnippetCommand } from "commands/snippets/EditSnippetCommand";
import { DeleteSnippetCommand } from "commands/snippets/DeleteSnippetCommand";
import { ListSnippetsCommand } from "commands/snippets/ListSnippetsCommand";
import { CloseCommand } from "commands/CloseCommand";
import { LogsCommand } from "commands/LogsCommand";
import { ContactCommand } from "commands/ContactCommand";
import { SettingsCommand } from "commands/SettingsCommand";
import { HelpCommand } from "commands/HelpCommand";
import { SayCommand } from "commands/SayCommand";
import { BotCommand } from "commands/bot/BotCommand";
import { AddBotCommand } from "commands/bot/AddBotCommand";
import { ListBotCommand } from "commands/bot/ListBotCommand";
import { ReloadBotCommand } from "commands/bot/ReloadBotCommand";
import { RemoveBotCommand } from "commands/bot/RemoveBotCommand";
import { RotateBotCommand } from "commands/bot/RotateBotCommand";
import { BotRepository } from "repositories/bot.repository";
import logger from "utils/logger";
import type { BotManager } from "./BotManager";

function buildCommandRouter(
  config: BotConfig,
  client: Client,
  db: DB,
  botManager: BotManager
): CommandRouter {
  const threadRepository = new ThreadRepository(db, config.guildId);
  const snippetRepository = new SnippetRepository(db);
  const runtimeConfigRepository = new RuntimeConfigRepository(
    db,
    config.discordClientId
  );
  const messageRepository = new MessageRepository(db);
  const botEmojiRepository = new BotEmojiRepository(db, config.discordClientId);
  const botRepository = new BotRepository(db);

  const threadService = new ThreadService(
    config,
    client,
    runtimeConfigRepository,
    threadRepository,
    botEmojiRepository
  );
  const messageService = new MessageRelayService(
    config,
    client,
    runtimeConfigRepository,
    threadRepository,
    messageRepository,
    botEmojiRepository
  );
  const snippetService = new SnippetService(config, client, snippetRepository);

  // Commands
  const router = new CommandRouter(runtimeConfigRepository, config);

  // Settings service
  const settingsService = new SettingsService(
    runtimeConfigRepository,
    botEmojiRepository
  );
  const sayService = new SayService();

  router.addCommands(
    // Reply commands
    new ReplyCommand(threadService, messageService, runtimeConfigRepository),
    new AnonymousReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),
    new AnonymousPlainReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),
    new PlainReplyCommand(
      threadService,
      messageService,
      runtimeConfigRepository
    ),

    // Thread message commands
    new EditCommand(threadService, messageService, runtimeConfigRepository),
    new DeleteCommand(threadService, messageService),

    // Snippets
    new GetSnippetCommand(snippetService),
    new AddSnippetCommand(snippetService),
    new EditSnippetCommand(snippetService),
    new DeleteSnippetCommand(snippetService),
    new ListSnippetsCommand(snippetService),

    // Other
    new CloseCommand(threadService, runtimeConfigRepository),
    new LogsCommand(threadService, messageService, runtimeConfigRepository),
    new ContactCommand(threadService, messageService),

    // Settings
    new SettingsCommand(settingsService),
    new HelpCommand(config),

    // Say
    new SayCommand(sayService),

    // Bot roster admin (owner-only, mention-gated -- see CommandRouter).
    // BotCommand (the bare `bot` handler) must be added before its
    // subcommands so CommandRouter.addCommands creates the "bot" entry
    // with a real handler first -- reversing the order would throw
    // "Duplicate command registered" since the entry would already exist
    // with handler: null from the first subcommand registration.
    new BotCommand(),
    new AddBotCommand(botManager),
    new ListBotCommand(botManager),
    new ReloadBotCommand(botManager, botRepository),
    new RemoveBotCommand(botManager, botRepository),
    new RotateBotCommand(botManager, botRepository)
  );

  snippetService.setReservedNames(router.getCommandNames());

  return router;
}

/**
 * Builds a fresh Client, command router, and event handlers for one roster
 * entry -- everything up to (but not including) the Discord login.
 * Intents/cache limits are constructor-time on Client, so this is also
 * what a `reload` has to redo in full -- there is no way to change
 * intents on a live client. Kept synchronous and separate from the login
 * step so BotManager can time-box the login and destroy the already-
 * constructed client if it times out or fails.
 *
 * Deliberately separate from BotManager (which calls this) to avoid a
 * circular import: BotManager needs this factory, and command handlers
 * reached via buildCommandRouter need BotManager.
 */
export function buildClient(
  entry: BotRosterEntry,
  globals: GlobalConfig,
  db: DB,
  botManager: BotManager
): Client {
  const config = BotConfig.fromRosterEntry(entry, globals);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
    ],
    // Partials.Channel: Required to receive DMs with Events.MessageCreate
    // Partials.Reaction and Partials.Message: Required to receive reactions on uncached messages
    partials: [
      Partials.Channel,
      Partials.Reaction,
      Partials.Message,
      Partials.GuildMember,
      // For reactions on non-cached messages
      Partials.Reaction,
      Partials.User,
    ],
    // Messages/members are always fetched by ID from event handlers rather
    // than read from cache, and the messages table is the source of truth --
    // caching is pure memory overhead here. Every channel the bot can see
    // (not just modmail threads) receives MESSAGE_CREATE, so without a low
    // cap MessageManager grows unbounded across the whole guild.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      UserManager: 200,
      GuildMemberManager: {
        maxSize: 200,
        keepOverLimit: (member) => member.id === member.client.user.id,
      },
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
      StageInstanceManager: 0,
      GuildBanManager: 0,
      GuildInviteManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      AutoModerationRuleManager: 0,
      ThreadMemberManager: 0,
      ApplicationCommandManager: 0,
    }),
  });

  logger.info({ bot: config.name }, "Initializing command router...");
  const router = buildCommandRouter(config, client, db, botManager);

  logger.info({ bot: config.name }, "Registering event handlers...");
  registerEventHandlers(config, client, db, router, botManager);

  return client;
}
