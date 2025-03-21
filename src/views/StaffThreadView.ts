import {
  EmbedBuilder,
  User,
  type GuildForumThreadCreateOptions,
  type MessageCreateOptions,
} from "discord.js";
import { Thread } from "../models/thread.model";
import type { StaffMessageOptions } from "services/MessageRelayService";

export class StaffThreadView {
  /**
   * Generates the initial message for a new modmail thread
   */
  static initialThreadMessage(userId: string): MessageCreateOptions {
    // TODO: Should include
    // - Display name, username
    // - Mention
    // - Mutual servers as bots
    // - Account / Member age
    // - Roles
    // - Previous threads

    return {
      content: `New ModMail from <@${userId}>`,
    };
  }

  /**
   * Generates the thread metadata (name, etc.)
   */
  static newThreadMetadata(
    userId: string,
    username: string
  ): Omit<GuildForumThreadCreateOptions, "message"> {
    return {
      name: `${username}`,
      reason: `New ModMail from ${userId}`,
    };
  }

  /**
   * Formats a list of threads for display
   * @param threads Array of threads to format
   * @returns Formatted string with thread information
   */
  static formatThreadList(threads: Thread[]): MessageCreateOptions {
    if (threads.length === 0) {
      return { content: "No previous threads found for this user." };
    }

    // Format each thread with additional information
    const threadLinks = threads
      .map((thread) => {
        const timestamp = `<t:${thread.createdAt.getUTCMilliseconds()}:D>`;
        const closer = thread.closedBy
          ? ` - Closed by <@${thread.closedBy}>`
          : "";
        const url = `https://discord.com/channels/${thread.guildId}/${thread.channelId}`;

        return `${timestamp} - ${closer} - ${url}`;
      })
      .join("\n");

    // TODO: Embeds
    return { content: `**Previous threads for this user:**\n${threadLinks}` };
  }

  /**
   * Creates an embed to display how a staff reply will appear to the user
   * @param staffUser The staff member who sent the reply
   * @param content The message content
   * @param options Options for formatting the reply
   * @returns A Discord MessageEmbed representing the staff reply
   */
  static staffReplyEmbed(
    staffUser: User,
    content: string,
    options: StaffMessageOptions = {}
  ): EmbedBuilder {
    const embed = new EmbedBuilder();

    // Set the author field based on anonymous option
    let authorName = staffUser.username;
    if (options.anonymous) {
      authorName += " (Anonymous)";
    }

    embed.setAuthor({
      name: authorName,
      iconURL: staffUser.displayAvatarURL(),
    });

    // Set the content
    embed.setDescription(content);

    // Set color and formatting based on options
    if (options.anonymous) {
      embed.setColor("#2F3136"); // Dark color for anonymous messages
    } else {
      embed.setColor("#5865F2"); // Discord blurple for regular messages
    }

    // Indicate if message is sent as plain text
    if (options.plainText) {
      embed.setFooter({ text: "Sent as plain text" });
    }

    // Set timestamp
    embed.setTimestamp();

    return embed;
  }
}
