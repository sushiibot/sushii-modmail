import {
  MessageReaction,
  User,
  type PartialMessageReaction,
  type PartialUser,
} from "discord.js";
import { getLogger } from "../utils/logger";

export interface StaffReactionRelayService {
  relayStaffReactionToUser(
    threadMessageId: string,
    emoji: string
  ): Promise<void>;
  relayStaffReactionRemovalToUser(
    threadMessageId: string,
    emoji: string
  ): Promise<void>;
}

export class StaffReactionController {
  private reactionService: StaffReactionRelayService;

  private logger = getLogger(this.constructor.name);

  constructor(reactionService: StaffReactionRelayService) {
    this.reactionService = reactionService;
  }

  async handleStaffReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (!reaction.message.channel.isThread()) {
        return;
      }

      await this.reactionService.relayStaffReactionToUser(
        reaction.message.id,
        reaction.emoji.identifier
      );
    } catch (err) {
      this.logger.error(err, `Error handling staff reaction`);
    }
  }

  async handleStaffReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (!reaction.message.channel.isThread()) {
        return;
      }

      await this.reactionService.relayStaffReactionRemovalToUser(
        reaction.message.id,
        reaction.emoji.identifier
      );
    } catch (err) {
      this.logger.error(err, `Error handling staff reaction removal`);
    }
  }
}
