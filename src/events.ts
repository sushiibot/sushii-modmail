import { Events, type Client } from "discord.js";
import type CommandRouter from "./CommandRouter";
import parentLogger, { getLogger } from "./utils/logger";
import type { DB } from "./database/db";
import { ThreadRepository } from "repositories/thread.repository";
import { ThreadService } from "services/ThreadService";
import { MessageRelayService } from "services/MessageRelayService";
import { DMController } from "controllers/DMController";
import type { ConfigModel } from "models/config.model";
import { SnippetController } from "controllers/SnippetController";
import { SnippetService } from "services/SnippetService";
import { SnippetRepository } from "repositories/snippet.repository";

export function registerEventHandlers(
  config: ConfigModel,
  client: Client,
  db: DB,
  commandRouter: CommandRouter
) {
  const logger = getLogger("events");

  const threadRepository = new ThreadRepository(db);
  const snippetRepository = new SnippetRepository(db);

  const threadService = new ThreadService(config, client, threadRepository);
  const snippetService = new SnippetService(config, client, snippetRepository);
  const messageService = new MessageRelayService(config, client);

  const dmController = new DMController(threadService, messageService);
  const snippetController = new SnippetController(
    config.prefix,
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
}
