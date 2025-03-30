import {
  ChannelType,
  MessageReaction,
  User,
  type PartialMessageReaction,
  type PartialUser,
} from "discord.js";
import { getLogger } from "../utils/logger";

export interface ReactionRelayService {
  relayUserReactionToStaff(
    userDmMessageId: string,
    userId: string,
    emojiIdentifier: string,
    emojiString?: string
  ): Promise<void>;
  relayUserReactionRemovalToStaff(
    userDmMessageId: string,
    userId: string,
    emojiIdentifier: string,
    emojiString?: string
  ): Promise<void>;
}

export class UserReactionController {
  private reactionService: ReactionRelayService;

  private logger = getLogger(this.constructor.name);

  constructor(reactionService: ReactionRelayService) {
    this.reactionService = reactionService;
  }

  async handleUserDMReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (reaction.message.channel.type !== ChannelType.DM) {
        return;
      }

      await this.reactionService.relayUserReactionToStaff(
        reaction.message.id,
        user.id,
        reaction.emoji.identifier,
        reaction.emoji.toString()
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM reaction`);
    }
  }

  async handleUserDMReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (reaction.message.channel.type !== ChannelType.DM) {
        return;
      }

      await this.reactionService.relayUserReactionRemovalToStaff(
        reaction.message.id,
        user.id,
        reaction.emoji.identifier,
        reaction.emoji.toString()
      );
    } catch (err) {
      this.logger.error(err, `Error handling DM reaction removal`);
    }
  }
}
