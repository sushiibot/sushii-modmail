import { ThreadRepository } from "../repositories/thread.repository";
import { ModmailController } from "../controllers/modmailController";
import { ThreadService } from "../services/threadService";
import { MessageRelayService } from "../services/MessageRelayService";
import type { DB } from "../database/db";

export function getDMHandler(db: DB): typeof controller.handleUserDM {
  const threadRepository = new ThreadRepository(db);
  const threadService = new ThreadService(threadRepository);
  const messageService = new MessageRelayService();

  const controller = new ModmailController(threadService, messageService);

  return controller.handleUserDM;
}
