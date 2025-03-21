import { Client, Message } from "discord.js";
import { ThreadRepository } from "../models/thread.model";
import { ModmailController } from "../controllers/modmailController";
import { ThreadService } from "../services/threadService";
import { MessageService } from "../services/messageService";
import type { DB } from "../database/db";

export function getDMHandler(db: DB): typeof controller.handleUserDM {
  const threadRepository = new ThreadRepository(db);
  const threadService = new ThreadService(threadRepository);
  const messageService = new MessageService();

  const controller = new ModmailController(threadService, messageService);

  return controller.handleUserDM;
}
