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

  const threadService = new ThreadService(
    config,
    client,
    threadRepository,
    runtimeConfigRepository
  );
  const snippetService = new SnippetService(config, client, snippetRepository);
  const messageService = new MessageRelayService(
    config,
    client,
    messageRepository
  );
  const reactionService = new ReactionRelayService(
    config,
    client,
    messageRepository
  );
  const logService = new DiscordLogService(config, client);

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
  const staffReactionController = new StaffReactionController(reactionService);
  const snippetController = new SnippetController(
    config,
    snippetService,
    threadService,
    messageService
  );

  client.once(Events.ClientReady, () => {
    logger.info(`Bot is online! ${client.user?.tag}`);
    // https://discord.com/oauth2/authorize?client_id=1111130119566790758&permissions=563362270660672&integration_type=0&scope=applications.commands+bot

    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user?.id}&permissions=563362270660672&integration_type=0&scope=applications.commands+bot`;
    logger.info(`Invite link: ${inviteLink}`);
  });

  client.on(Events.GuildCreate, (guild) => {
    logger.info(`Joined server: ${guild.name}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) {
      return;
    }

    if (message.content === "ping") {
      await message.reply("pong");
    }

    await Promise.allSettled([
      commandRouter.handleMessage(message),
      dmController.handleUserDM(message.client, message),
      snippetController.handleThreadMessage(message.client, message),
    ]);
  });

  client.on(Events.MessageUpdate, async (_, newMessage) => {
    if (newMessage.author.bot) {
      return;
    }

    await Promise.allSettled([dmController.handleUserDMEdit(newMessage)]);
  });

  client.on(Events.MessageDelete, async (oldMessage) => {
    if (oldMessage?.author?.bot) {
      return;
    }

    await Promise.allSettled([dmController.handleUserDMDelete(oldMessage)]);
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) {
      return;
    }

    await Promise.allSettled([
      userReactionController.handleUserDMReactionAdd(reaction, user),
      staffReactionController.handleStaffReactionAdd(reaction, user),
    ]);
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (user.bot) {
      return;
    }

    await Promise.allSettled([
      userReactionController.handleUserDMReactionRemove(reaction, user),
      staffReactionController.handleStaffReactionRemove(reaction, user),
    ]);
  });
}
