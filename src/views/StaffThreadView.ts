import {
  AttachmentBuilder,
  Collection,
  EmbedBuilder,
  MessageFlags,
  type GuildForumThreadCreateOptions,
  type MessageCreateOptions,
} from "discord.js";
import { Thread } from "../models/thread.model";
import {
  defaultStaffMessageOptions,
  type StaffMessageOptions,
} from "services/MessageRelayService";
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
    // - Mutual servers
    // - Previous threads

    const embed = new EmbedBuilder()
      .setAuthor({
        name: formatUserIdentity(
          userInfo.user.id,
          userInfo.user.username,
          userInfo.member?.nickname
        ),
        iconURL:
          userInfo.member?.avatarURL() || userInfo.user.displayAvatarURL(),
      })
      .setColor(Color.Gray)
      .setTimestamp();

    const createdTs = Math.floor(userInfo.user.createdTimestamp / 1000);
    let description = `<@${userInfo.user.id}>\n`;
    description += `User created at <t:${createdTs}:R>`;

    if (userInfo.member) {
      if (userInfo.member.joinedTimestamp) {
        const joinedTs = Math.floor(userInfo.member.joinedTimestamp / 1000);

        description += `\nJoined server at <t:${joinedTs}:R>`;
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
      // content: `@here`,
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
      // Need user ID in the thread name to allow searching by ID
      name: `${username} - ${userId}`,
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
    options: StaffMessageOptions = defaultStaffMessageOptions
  ): EmbedBuilder {
    // Set the author field based on anonymous option
    let authorName = staffUser.username;
    if (options.anonymous) {
      authorName += " (Anonymous)";
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: authorName,
        iconURL: staffUser.displayAvatarURL(),
      })
      .setColor(Color.Green)
      .setDescription(content)
      .setTimestamp();

    if (options.snippet) {
      embed.setFooter({ text: "Sent from snippet" });
    }

    // Indicate if message is sent as plain text
    if (options.plainText) {
      embed.setFooter({ text: "Sent as plain text" });
    }

    return embed;
  }

  static systemMessage(
    content: string,
    options: {
      automated: boolean;
    } = { automated: true }
  ): MessageCreateOptions {
    let name = "System";
    if (options.automated) {
      name += " (Automated)";
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: name,
      })
      .setDescription(content)
      .setColor(Color.Gray)
      .setTimestamp();

    return {
      embeds: [embed],
    };
  }

  static userReplyDeletedMessage(
    messageId: string,
    previousMessageId?: string
  ): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setTitle("Message deleted")
      .setDescription(`Message ID: ${messageId}`)
      .setColor(Color.Pink)
      .setTimestamp();

    const msg: MessageCreateOptions = {
      embeds: [embed],
    };

    if (previousMessageId) {
      msg.reply = {
        messageReference: previousMessageId,
      };
    }

    return msg;
  }

  static async userReplyEditedMessage(
    newUserMessage: StaffViewUserMessage,
    previousMessageId?: string
  ): Promise<MessageCreateOptions> {
    // Edited messages just do the same thing as new messages but reply to the
    // original message

    const embed = StaffThreadView.createUserReplyEmbed(newUserMessage)
      .setTitle("Message edited")
      .setColor(Color.Purple);

    let msg: MessageCreateOptions = {
      embeds: [embed],
    };

    if (previousMessageId) {
      msg.reply = {
        messageReference: previousMessageId,
      };
    }

    return msg;
  }

  /**
   * Creates an embed for a user's message without handling attachments
   */
  static createUserReplyEmbed(userMessage: StaffViewUserMessage): EmbedBuilder {
    const fields = [];

    if (userMessage.attachments.size > 0) {
      const attachments = Array.from(userMessage.attachments.values())
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n");

      const name =
        userMessage.attachments.size > 1 ? "Attachments" : "Attachment";

      fields.push({
        name: `Original ${name}`,
        value: attachments,
      });
    }

    if (userMessage.stickers.size > 0) {
      const stickers = Array.from(userMessage.stickers.values())
        .map((sticker) => `[${sticker.name}](${sticker.url})`)
        .join("\n");

      const name = userMessage.stickers.size > 1 ? "Stickers" : "Sticker";

      fields.push({
        name: name,
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
      .setColor(Color.Blue)
      .setFooter({
        text: `Message ID: ${userMessage.id}`,
      })
      .setFields(fields)
      .setTimestamp();

    if (userMessage.content) {
      embed.setDescription(userMessage.content);
    }

    return embed;
  }

  static async userReplyMessage(
    userMessage: StaffViewUserMessage
  ): Promise<MessageCreateOptions> {
    const embed = StaffThreadView.createUserReplyEmbed(userMessage);

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
