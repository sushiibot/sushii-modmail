import type { Client } from "discord.js";
import type CommandRouter from "./CommandRouter";
import parentLogger from "./utils/logger";
import { getDMHandler } from "handlers/dmHandler";
import type { DB } from "./database/db";

const logger = parentLogger.child({ module: "events" });

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

  const dmHandler = getDMHandler(db);

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }

    if (message.content === "ping") {
      message.reply("pong");
    }

    await dmHandler(message.client, message);
  });
}
