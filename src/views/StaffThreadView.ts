import {
  AttachmentBuilder,
  Collection,
  EmbedBuilder,
  MessageFlags,
  type GuildForumThreadCreateOptions,
  type MessageCreateOptions,
} from "discord.js";
import { Thread } from "../models/thread.model";
import type { StaffMessageOptions } from "services/MessageRelayService";
import { formatUserIdentity } from "./user";
import { Color } from "./Color";
import { fetch, file } from "bun";

interface MemberRole {
  id: string;
  rawPosition: number;
}

interface User {
  id: string;
  displayName: string;
  username: string;
  displayAvatarURL(): string;
}

interface UserThreadInfo {
  user: User & {
    createdTimestamp: number;
  };
  member: {
    roles: {
      cache: Collection<string, MemberRole>;
    };
    joinedTimestamp: number | null;
    nickname: string | null;
    avatarURL(): string | null;
  } | null;
  mutualGuilds?: { id: string; name: string }[];
  previousThreads?: Thread[];
}

interface Attachment {
  id: string;
  name: string;
  url: string;
}

interface Sticker {
  id: string;
  name: string;
  url: string;
}

export interface StaffViewUserMessage {
  id: string;
  author: User;
  content: string;
  attachments: Collection<string, Attachment>;
  stickers: Collection<string, Sticker>;
}

export class StaffThreadView {
  /**
   * Generates the initial message for a new modmail thread
   */
  static initialThreadMessage(userInfo: UserThreadInfo): MessageCreateOptions {
    // TODO: Should include
    // - Display name, username
    // - Mention
    // - Mutual servers as bots
    // - Account / Member age
    // - Roles
    // - Previous threads

    const embed = new EmbedBuilder().setAuthor({
      name: formatUserIdentity(
        userInfo.user.id,
        userInfo.user.username,
        userInfo.member?.nickname
      ),
      iconURL: userInfo.member?.avatarURL() || userInfo.user.displayAvatarURL(),
    });

    const createdTs = Math.floor(userInfo.user.createdTimestamp / 1000);
    let description = `<@${userInfo.user.id}>`;
    description += `User created at <t:${createdTs}:R>`;

    if (userInfo.member) {
      if (userInfo.member.joinedTimestamp) {
        const joinedTs = Math.floor(userInfo.member.joinedTimestamp / 1000);

        description += `\nJoined guild at <t:${joinedTs}:R>`;
      }
    }

    embed.setDescription(description);

    // Fields
    const fields = [];
    if (userInfo.member) {
      const roles = Array.from(userInfo.member.roles.cache.values())
        .sort((a, b) => b.rawPosition - a.rawPosition)
        .map((role) => `<@&${role.id}>`);

      fields.push({
        name: "Roles",
        value: roles.join(", ") || "None",
      });
    }

    if (userInfo.mutualGuilds) {
      fields.push({
        name: "Mutual Servers",
        value: userInfo.mutualGuilds.map((g) => g.name).join(", ") || "None",
      });
    }

    if (userInfo.previousThreads) {
      fields.push({
        name: "Previous Threads",
        value:
          userInfo.previousThreads
            .map((thread) => thread.toString())
            .join("\n") || "None",
      });
    }

    embed.addFields(fields);

    return {
      content: `@here`,
      embeds: [embed],
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
    const threadLinks = threads.map((thread) => thread.toString()).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Previous user threads")
      .setDescription(threadLinks)
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
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
    // Set the author field based on anonymous option
    let authorName = staffUser.username;
    if (options.anonymous) {
      authorName += " (Anonymous)";
    }

    if (options.snippet) {
      authorName += " - snippet";
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: authorName,
        iconURL: staffUser.displayAvatarURL(),
      })
      .setColor(Color.Lavender)
      .setDescription(content)
      .setTimestamp();

    // Indicate if message is sent as plain text
    if (options.plainText) {
      embed.setFooter({ text: "Sent as plain text" });
    }

    return embed;
  }

  static systemMessage(content: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: "System (Automated Message)",
      })
      .setDescription(content)
      .setColor(Color.Gray)
      .setTimestamp();

    return {
      embeds: [embed],
    };
  }

  static async userReplyMessage(
    userMessage: StaffViewUserMessage
  ): Promise<MessageCreateOptions> {
    const description = userMessage.content;

    const fields = [];

    if (userMessage.attachments.size > 0) {
      const attachments = Array.from(userMessage.attachments.values())
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n");

      fields.push({
        name: "Original Attachment URLs",
        value: attachments,
      });
    }

    if (userMessage.stickers.size > 0) {
      const stickers = Array.from(userMessage.stickers.values())
        .map((sticker) => `[${sticker.name}](${sticker.url})`)
        .join("\n");

      fields.push({
        name: "Stickers",
        value: stickers,
      });
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: formatUserIdentity(
          userMessage.author.id,
          userMessage.author.username
        ),
        iconURL: userMessage.author.displayAvatarURL() || undefined,
      })
      .setDescription(description)
      .setColor(Color.Blue)
      .setFooter({
        text: `Message ID: ${userMessage.id}`,
      })
      .setFields(fields)
      .setTimestamp();

    // Re-upload attachments
    const fileDownloads = Array.from(userMessage.attachments.values()).map(
      async (file) => {
        const res = await fetch(file.url);
        const arrBuf = await res.arrayBuffer();
        const attachment = new AttachmentBuilder(Buffer.from(arrBuf)).setName(
          file.name
        );

        return attachment;
      }
    );

    // Download files in parallel
    const files = await Promise.all(fileDownloads);

    return {
      embeds: [embed],
      files: files,
    };
  }
}
