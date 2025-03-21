import type { Client } from "discord.js";
import type CommandRouter from "./CommandRouter";
import parentLogger from "./utils/logger";
import type { DB } from "./database/db";
import { ThreadRepository } from "repositories/thread.repository";
import { ThreadService } from "services/ThreadService";
import { MessageRelayService } from "services/MessageRelayService";
import { DMController } from "controllers/DMController";

const logger = parentLogger.child({ module: "events" });

function getDMHandler(db: DB): DMController {
  const threadRepository = new ThreadRepository(db);
  const threadService = new ThreadService(threadRepository);
  const messageService = new MessageRelayService();

  return new DMController(threadService, messageService);
}

export function registerEventHandlers(
  client: Client,
  db: DB,
  commandRouter: CommandRouter
) {
  client.once("ready", () => {
    logger.info(`Bot is online! ${client.user?.tag}`);
    // https://discord.com/oauth2/authorize?client_id=1111130119566790758&permissions=563362270660672&integration_type=0&scope=applications.commands+bot

    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${client.user?.id}&permissions=563362270660672&integration_type=0&scope=applications.commands+bot`;
    logger.info(`Invite link: ${inviteLink}`);
  });

  client.on("guildCreate", (guild) => {
    logger.info(`Joined server: ${guild.name}`);
  });

  const dmController = getDMHandler(db);

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }

    if (message.content === "ping") {
      message.reply("pong");
    }

    await Promise.allSettled([
      commandRouter.handleMessage(message),
      dmController.handleUserDM(message.client, message),
    ]);
  });
}
