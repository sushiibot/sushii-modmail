import { Events, type Client } from "discord.js";
import type CommandRouter from "./CommandRouter";
import parentLogger, { getLogger } from "./utils/logger";
import type { DB } from "./database/db";
import { ThreadRepository } from "repositories/thread.repository";
import { ThreadService } from "services/ThreadService";
import { MessageRelayService } from "services/MessageRelayService";
import { DMController } from "controllers/DMController";
import type { BotConfig } from "models/botConfig.model";
import { SnippetController } from "controllers/SnippetController";
import { SnippetService } from "services/SnippetService";
import { SnippetRepository } from "repositories/snippet.repository";
import { RuntimeConfigRepository } from "repositories/runtimeConfig.repository";
import { MessageRepository } from "repositories/message.repository";
import { ReactionRelayService } from "services/ReactionRelayService";
import { UserReactionController } from "controllers/UserReactionController";
import { StaffReactionController } from "controllers/StaffReactionController";
import { DiscordLogService } from "services/LogService";
import { BotEmojiRepository } from "repositories/botEmoji.repository";
import { DiscordBotEmojiService } from "services/BotEmojiService";
import { BotEmojiController } from "controllers/BotEmojiController";
import { SettingsModalController } from "controllers/SettingsModalController";
import { SettingsService } from "services/SettingsService";

export function registerEventHandlers(
  config: BotConfig,
  client: Client,
  db: DB,
  commandRouter: CommandRouter
) {
  const logger = getLogger("events");

  const threadRepository = new ThreadRepository(db);
  const snippetRepository = new SnippetRepository(db);
  const runtimeConfigRepository = new RuntimeConfigRepository(db);
  const messageRepository = new MessageRepository(db);
  const botEmojiRepository = new BotEmojiRepository(db);

  const threadService = new ThreadService(
    config,
    client,
    runtimeConfigRepository,
    threadRepository
  );
  const snippetService = new SnippetService(config, client, snippetRepository);
  const messageService = new MessageRelayService(
    config,
    client,
    runtimeConfigRepository,
    messageRepository
  );
  const reactionService = new ReactionRelayService(
    config,
    client,
    messageRepository
  );
  const logService = new DiscordLogService(
    client,
    runtimeConfigRepository,
    config.guildId
  );
  const botEmojiService = new DiscordBotEmojiService(botEmojiRepository);
  const settingsService = new SettingsService(
    runtimeConfigRepository,
    botEmojiRepository
  );

  const dmController = new DMController(
    threadService,
    messageService,
    reactionService,
    logService
  );
  const userReactionController = new UserReactionController(
    reactionService,
    logService
  );
  const staffReactionController = new StaffReactionController(
    reactionService,
    runtimeConfigRepository
  );
  const snippetController = new SnippetController(
    snippetService,
    threadService,
    messageService,
    runtimeConfigRepository
  );
  const botEmojiController = new BotEmojiController(
    botEmojiService,
    botEmojiRepository
  );
  const settingsModalController = new SettingsModalController(settingsService);

  client.once(Events.ClientReady, async (client) => {
    logger.info(`Bot is online! ${client.user.tag}`);
    // https://discord.com/oauth2/authorize?client_id=1111130119566790758&permissions=563362270660672&integration_type=0&scope=applications.commands+bot

    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user?.id}&permissions=563362270660672&integration_type=0&scope=applications.commands+bot`;
    logger.info(`Invite link: ${inviteLink}`);

    // Sync emojis on startup
    try {
      await botEmojiController.syncEmojis(client);
      await botEmojiController.verifyRegisteredEmojis();
      logger.info("Bot emojis synced.");
    } catch (err) {
      logger.error(err, "Failed to sync bot emojis on startup");
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    logger.info(`Joined server: ${guild.name}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) {
        return;
      }

      await Promise.allSettled([
        commandRouter.handleMessage(message),
        dmController.handleUserDM(message.client, message),
        snippetController.handleThreadMessage(message.client, message),
      ]);
    } catch (err) {
      logger.error(
        {
          messageId: message.id,
          userId: message.author.id,
          userName: message.author.username,
          guildId: message.guildId,
        },
        "Error handling message"
      );
    }
  });

  client.on(Events.MessageUpdate, async (_, newMessage) => {
    try {
      if (newMessage.author.bot) {
        return;
      }

      await Promise.allSettled([dmController.handleUserDMEdit(newMessage)]);
    } catch (err) {
      logger.error(
        {
          messageId: newMessage.id,
          userId: newMessage.author.id,
          userName: newMessage.author.username,
          guildId: newMessage.guildId,
        },
        "Error handling message update"
      );
    }
  });

  client.on(Events.MessageDelete, async (oldMessage) => {
    try {
      if (oldMessage?.author?.bot) {
        return;
      }

      await Promise.allSettled([dmController.handleUserDMDelete(oldMessage)]);
    } catch (err) {
      logger.error(
        {
          messageId: oldMessage.id,
          guildId: oldMessage.guildId,
        },
        "Error handling message delete"
      );
    }
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      await Promise.allSettled([
        userReactionController.handleUserDMReactionAdd(reaction, user),
        staffReactionController.handleStaffReactionAdd(reaction, user),
      ]);
    } catch (err) {
      logger.error(
        {
          reaction: reaction.emoji.name,
          userId: user.id,
          userName: user.username,
          guildId: reaction.message.guildId,
        },
        "Error handling reaction"
      );
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      await Promise.allSettled([
        userReactionController.handleUserDMReactionRemove(reaction, user),
        staffReactionController.handleStaffReactionRemove(reaction, user),
      ]);
    } catch (err) {
      logger.error(
        {
          reaction: reaction.emoji.name,
          userId: user.id,
          userName: user.username,
          guildId: reaction.message.guildId,
        },
        "Error handling reaction"
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isModalSubmit()) {
        await settingsModalController.handleModal(interaction);
      }
    } catch (err) {
      logger.error(
        {
          interactionId: interaction.id,
          type: interaction.type,
          userId: interaction.user.id,
          userName: interaction.user.username,
          guildId: interaction.guildId,
        },
        "Error handling interaction"
      );
    }
  });
}
