import {
  AttachmentBuilder,
  Collection,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
  type BaseMessageOptions,
  type GuildForumThreadCreateOptions,
  type MessageCreateOptions,
} from "discord.js";
import { Thread } from "../models/thread.model";
import {
  defaultStaffMessageOptions,
  type StaffMessageOptions,
} from "services/MessageRelayService";
import { formatUserIdentity } from "./user";
import { Color, HexColor } from "./Color";
import { downloadAttachments } from "./util";
import type {
  UserToStaffMessage,
  StaffRelayMessage,
} from "../models/relayMessage";
import type { BotEmojiName, MessageEmojiMap } from "models/botEmoji.model";

export const MediaGalleryAttachmentsID = 101;
export const MediaGalleryStickersID = 102;

export const StaffThreadEmojis = [
  "message_id",
  "user",
] as const satisfies readonly BotEmojiName[];

export type StaffThreadEmojis = MessageEmojiMap<typeof StaffThreadEmojis>;

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

export class StaffThreadView {
  /**
   * Generates the initial message for a new modmail thread
   */
  static initialThreadMessage(userInfo: UserThreadInfo): MessageCreateOptions {
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
  static createThreadOptions(
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

  static staffReplyComponents(
    msg: StaffRelayMessage,
    options: StaffMessageOptions = defaultStaffMessageOptions,
    displayOptions: {
      editedById?: string;
      deletedById?: string;
    } = {}
  ): BaseMessageOptions["components"] {
    const container = new ContainerBuilder();

    if (displayOptions.deletedById) {
      container.setAccentColor(HexColor.Gray);
    } else {
      container.setAccentColor(HexColor.Green);
    }

    // Set the author field based on anonymous option
    let authorName = `### Staff reply from <@${msg.author.id}>`;
    if (options.anonymous) {
      authorName += " (Anonymous)";
    }

    const authorText = new TextDisplayBuilder().setContent(authorName);
    container.addTextDisplayComponents(authorText);

    // Add content
    if (msg.content) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const contentText = new TextDisplayBuilder().setContent(msg.content);
      container.addTextDisplayComponents(contentText);
    }

    // Add attachments
    if (msg.attachments.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());

      const attachmentItems = msg.attachments.map(
        // Reference file links
        (attachment) => {
          if (typeof attachment === "string") {
            return new MediaGalleryItemBuilder().setURL(attachment);
          }

          return new MediaGalleryItemBuilder().setURL(attachment.url);
        }
      );
      const attachmentText = new MediaGalleryBuilder()
        .setId(MediaGalleryAttachmentsID)
        .addItems(attachmentItems);

      container.addMediaGalleryComponents(attachmentText);
    }

    // Add stickers
    if (msg.stickers.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());

      const stickerItems = msg.stickers.map((sticker) => {
        return new MediaGalleryItemBuilder()
          .setURL(sticker.url)
          .setDescription(sticker.name);
      });
      const stickerText = new MediaGalleryBuilder()
        .setId(MediaGalleryStickersID)
        .addItems(stickerItems);

      container.addMediaGalleryComponents(stickerText);
    }

    // Add metadata
    container.addSeparatorComponents(new SeparatorBuilder());
    let metadataStr = "\n";

    if (displayOptions.editedById) {
      metadataStr += `\nEdited by <@${displayOptions.editedById}>`;
    }

    if (displayOptions.deletedById) {
      metadataStr += `\nDeleted by <@${displayOptions.deletedById}>`;
    }

    if (options.plainText) {
      metadataStr += `\nSent as plain text`;
    }

    if (options.snippet) {
      metadataStr += `\nSent from snippet`;
    }

    metadataStr += `\nMessage ID: \`${msg.id}\``;
    const metadataText = new TextDisplayBuilder().setContent(metadataStr);
    container.addTextDisplayComponents(metadataText);

    return [container];
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
      .setColor(Color.Purple)
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
    newUserMessage: UserToStaffMessage,
    emojis: StaffThreadEmojis,
    previousMessageId?: string
  ): Promise<MessageCreateOptions> {
    // Edited messages just do the same thing as new messages but reply to the
    // original message

    const components = this.userReplyComponents(
      newUserMessage,
      [],
      true,
      emojis
    );

    let msg: MessageCreateOptions = {
      components: components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        parse: [],
      },
    };

    if (previousMessageId) {
      msg.reply = {
        messageReference: previousMessageId,
      };
    }

    return msg;
  }

  /**
   * Creates v2 components for a user reply message, created or edited. Message
   * edits can only change the content, so attachments and stickers are excluded
   * when isEdited is true.
   *
   * @param userMessage
   * @param attachments
   * @param isEdited
   * @returns
   */
  static userReplyComponents(
    userMessage: UserToStaffMessage,
    attachments: AttachmentBuilder[],
    isEdited: boolean,
    emojis: StaffThreadEmojis
  ): BaseMessageOptions["components"] {
    const container = new ContainerBuilder();

    if (isEdited) {
      container.setAccentColor(HexColor.Purple);
    } else {
      container.setAccentColor(HexColor.Blue);
    }

    // 1. Author
    // 2. Content
    // 3. Attachments, stickers
    // 4. Metadata (links to attachments, stickers, timestamps, ID)

    // 1. Author
    const author = `### User message from <@${userMessage.author.id}>`;
    const authorText = new TextDisplayBuilder().setContent(author);
    container.addTextDisplayComponents(authorText);

    // 2. Content (optional)
    if (userMessage.content) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const contentText = new TextDisplayBuilder().setContent(
        userMessage.content
      );
      container.addTextDisplayComponents(contentText);
    }

    // 3. Attachments - use reuploaded attachments
    if (!isEdited && attachments.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());

      const attachmentItems = attachments.map((attachment) =>
        // Reference file attachments
        new MediaGalleryItemBuilder().setURL(`attachment://` + attachment.name)
      );
      const attachmentText = new MediaGalleryBuilder().addItems(
        attachmentItems
      );

      container.addMediaGalleryComponents(attachmentText);
    }

    if (userMessage.stickers.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());

      const stickerItems = userMessage.stickers.map((sticker) =>
        new MediaGalleryItemBuilder()
          .setURL(sticker.url)
          .setDescription(sticker.name)
      );
      const stickerText = new MediaGalleryBuilder().addItems(stickerItems);

      container.addMediaGalleryComponents(stickerText);
    }

    // 4. Metadata
    container.addSeparatorComponents(new SeparatorBuilder());

    let metadataStr = "";

    if (!isEdited && userMessage.attachments.length > 0) {
      const attachmentLinks = userMessage.attachments
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n");

      metadataStr += `\n**Attachment links:**\n${attachmentLinks}`;
    }

    if (!isEdited && userMessage.stickers.length > 0) {
      const stickerLinks = userMessage.stickers
        .map((sticker) => `[${sticker.name}](${sticker.url})`)
        .join("\n");

      metadataStr += `\n**Stickers:**\n${stickerLinks}`;
    }

    metadataStr += `\n\n${emojis.user} User ID: \`${userMessage.author.id}\``;
    metadataStr += `\n${emojis.message_id} Message ID: \`${userMessage.id}\``;

    const metadataText = new TextDisplayBuilder().setContent(metadataStr);
    container.addTextDisplayComponents(metadataText);

    return [container];
  }

  static async userReplyMessage(
    userMessage: UserToStaffMessage,
    emojis: StaffThreadEmojis
  ): Promise<MessageCreateOptions> {
    const files = await downloadAttachments(userMessage.attachments);

    const components = this.userReplyComponents(
      userMessage,
      files,
      false,
      emojis
    );
    return {
      files: files,
      components: components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        parse: [],
      },
    };
  }
}
