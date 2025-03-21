import { type MessageCreateOptions } from "discord.js";

export class ThreadView {
  /**
   * Generates the initial message for a new modmail thread
   */
  static newThreadMessage(userId: string): MessageCreateOptions {
    return {
      content: `New ModMail from <@${userId}>`,
      // You could add embeds, components, etc. here
    };
  }

  /**
   * Generates the thread metadata (name, etc.)
   */
  static newThreadMetadata(
    userId: string,
    username: string
  ): {
    name: string;
    reason: string;
  } {
    return {
      name: `${username}`,
      reason: `New ModMail from ${userId}`,
    };
  }
}
