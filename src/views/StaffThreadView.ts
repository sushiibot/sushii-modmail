import {
  AttachmentBuilder,
  Collection,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
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
import { downloadAttachments, quoteText } from "./util";
import type {
  UserToStaffMessage,
  StaffRelayMessage,
} from "../models/relayMessage";
import type { BotEmojiName, MessageEmojiMap } from "models/botEmoji.model";
import type { MessageVersion } from "models/messageVersion.model";

export const MediaGalleryAttachmentsID = 101;
export const MediaGalleryStickersID = 102;

const MAX_MESSAGE_LENGTH = 4000;

export const StaffThreadEmojis = [
  "message_id",
  "user",
  "forward",
  "edit",
  "delete",
  "snippet",
  "plain_text",
  "arrow_down_right",
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
  static initialThreadMessage(
    emojis: StaffThreadEmojis,
    userInfo: UserThreadInfo,
    notificationRoleId: string | null,
    silent: boolean
  ): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Gray);

    let content = `### Modmail Thread`;

    // Basic info
    content += `\n${emojis.user} <@${userInfo.user.id}>`;
    content += `\n${emojis.user} Username: \`${userInfo.user.username}\``;
    content += `\n${emojis.arrow_down_right} User ID: \`${userInfo.user.id}\``;
    if (userInfo.member?.nickname) {
      content += `\n${emojis.arrow_down_right} Server Nickname: \`${userInfo.member.nickname}\``;
    }

    // Timestamps
    const createdTs = Math.floor(userInfo.user.createdTimestamp / 1000);
    content += `\n${emojis.arrow_down_right} Created Account: <t:${createdTs}:R>`;

    if (userInfo.member?.joinedTimestamp) {
      const joinedTs = Math.floor(userInfo.member.joinedTimestamp / 1000);

      content += `\n${emojis.arrow_down_right} Joined Server: <t:${joinedTs}:R>`;
    }

    // Roles
    if (userInfo.member) {
      content += `\n### Roles`;

      const roles = Array.from(userInfo.member.roles.cache.values())
        .sort((a, b) => b.rawPosition - a.rawPosition)
        .map((role) => `<@&${role.id}>`);

      content += `\n${roles.join(", ") || "None"}`;
    }

    // Mutual servers
    if (userInfo.mutualGuilds) {
      content += `\n### Mutual Servers`;

      const mutualServers = userInfo.mutualGuilds.map((g) => g.name).join("\n");

      content += `\n${mutualServers || "None"}`;
    }

    // Previous threads
    if (userInfo.previousThreads) {
      content += `\n### Previous Threads`;
      const previousThreads = userInfo.previousThreads
        .map((thread) => thread.toString())
        .join("\n");
      content += `\n${previousThreads || "None"}`;
    }

    const userinfoText = new TextDisplayBuilder().setContent(content);

    const userinfoSection = new SectionBuilder()
      .setThumbnailAccessory((t) => t.setURL(userInfo.user.displayAvatarURL()))
      .addTextDisplayComponents(userinfoText);

    container.addSectionComponents(userinfoSection);

    // Add the ping
    if (notificationRoleId) {
      container.addSeparatorComponents(new SeparatorBuilder());

      let notificationContent = `-# Notification role: <@&${notificationRoleId}>`;
      if (silent) {
        notificationContent += ` (silent)`;
      }

      const notificationText = new TextDisplayBuilder().setContent(
        notificationContent
      );

      container.addTextDisplayComponents(notificationText);
    }

    if (silent) {
      return {
        components: [container],
        flags: [
          MessageFlags.IsComponentsV2,
          // Silent notification
          MessageFlags.SuppressNotifications,
        ],
      };
    }

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
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
    emojis: StaffThreadEmojis,
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
    let authorName = `### Staff - <@${msg.author.id}>`;
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
    let metadataStr = "\n";

    if (displayOptions.editedById) {
      metadataStr += `\n${emojis.edit} Edited by <@${displayOptions.editedById}>`;
    }

    if (displayOptions.deletedById) {
      metadataStr += `\n${emojis.delete} Deleted by <@${displayOptions.deletedById}>`;
    }

    if (options.plainText) {
      metadataStr += `\n${emojis.plain_text} Sent as plain text`;
    }

    if (options.snippet) {
      metadataStr += `\n${emojis.snippet} Sent from snippet`;
    }

    // Only add if there's content
    if (metadataStr.trim().length > 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const metadataText = new TextDisplayBuilder().setContent(metadataStr);
      container.addTextDisplayComponents(metadataText);
    }

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
    messageVersions: MessageVersion[],
    isEdited: boolean,
    emojis: StaffThreadEmojis
  ): BaseMessageOptions["components"][] {
    const primaryContainer = new ContainerBuilder();

    // This will currently only be: empty OR 1 additional message with edits.
    const additionalMessages = [];

    if (isEdited) {
      primaryContainer.setAccentColor(HexColor.Purple);
    } else {
      primaryContainer.setAccentColor(HexColor.Blue);
    }

    // 1. Author
    // 2. Content
    // 3. Attachments, stickers
    // 4. Metadata (links to attachments, stickers, timestamps, ID)

    // 1. Author
    const author = `### User - <@${userMessage.author.id}>`;
    const authorText = new TextDisplayBuilder().setContent(author);
    primaryContainer.addTextDisplayComponents(authorText);

    // 2. Content (optional)
    if (userMessage.content) {
      primaryContainer.addSeparatorComponents(new SeparatorBuilder());
      const contentText = new TextDisplayBuilder().setContent(
        userMessage.content
      );
      primaryContainer.addTextDisplayComponents(contentText);
    }

    if (messageVersions.length > 0) {
      primaryContainer.addSeparatorComponents(new SeparatorBuilder());

      const editHistoryItems = messageVersions.map((version) => {
        const editTs = Math.floor(version.editedAt.getTime() / 1000);
        let s = `<t:${editTs}:f>`;
        s += `\n${quoteText(version.content)}`;

        return s;
      });

      let editHistoryText = `### Message Edits`;
      editHistoryText += `\n${editHistoryItems.join("\n")}`;

      // Check if current content + edit history exceeds max length
      if (
        userMessage.content.length + editHistoryText.length >
        MAX_MESSAGE_LENGTH
      ) {
        // If it does, replace this logic to use a dedicated message for edits
        const additionalMsg = this.userReplyComponentsAdditionalEdits(
          messageVersions,
          emojis
        );

        additionalMessages.push(additionalMsg);
      } else {
        // Fine to continue with the primary message
        const editTextDisplay = new TextDisplayBuilder().setContent(
          editHistoryText
        );

        primaryContainer.addTextDisplayComponents(editTextDisplay);
      }
    }

    // 3. Attachments - use reuploaded attachments
    if (!isEdited && attachments.length > 0) {
      primaryContainer.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
      );

      const attachmentItems = attachments.map((attachment) =>
        // Reference file attachments
        new MediaGalleryItemBuilder().setURL(`attachment://` + attachment.name)
      );
      const attachmentText = new MediaGalleryBuilder().addItems(
        attachmentItems
      );

      primaryContainer.addMediaGalleryComponents(attachmentText);
    }

    if (userMessage.stickers.length > 0) {
      primaryContainer.addSeparatorComponents(new SeparatorBuilder());

      const stickerItems = userMessage.stickers.map((sticker) =>
        new MediaGalleryItemBuilder()
          .setURL(sticker.url)
          .setDescription(sticker.name)
      );
      const stickerText = new MediaGalleryBuilder().addItems(stickerItems);

      primaryContainer.addMediaGalleryComponents(stickerText);
    }

    // 4. Metadata
    primaryContainer.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );

    let metadataStr = "";

    if (!isEdited && userMessage.attachments.length > 0) {
      const attachmentLinks = userMessage.attachments
        .map((attachment) => `[${attachment.name}](${attachment.url})`)
        .join("\n");

      metadataStr += `\n**Attachment links:**`;
      metadataStr += `\n${attachmentLinks}`;
    }

    if (!isEdited && userMessage.stickers.length > 0) {
      const stickerLinks = userMessage.stickers
        .map((sticker) => `[${sticker.name}](${sticker.url})`)
        .join("\n");

      metadataStr += `\n**Stickers:**`;
      metadataStr += `\n${stickerLinks}`;
    }

    if (userMessage.forwarded === true) {
      metadataStr += `\n\n${emojis.forward} Forwarded message`;
    }

    metadataStr += `\n${emojis.user} User ID: \`${userMessage.author.id}\``;

    const metadataText = new TextDisplayBuilder().setContent(metadataStr);
    primaryContainer.addTextDisplayComponents(metadataText);

    // Primary + any additional messages
    return [[primaryContainer], ...additionalMessages];
  }

  /**
   * Creates a v2 components dedicated to edits only. Any older edits that
   * cause it to exceed 4_000 characters will cause it to currently just omit
   * the oldest edits. Since it's unlikely that a very large message will be
   * edited so many times, it's an edge case that isn't worth making it overly
   * complex.
   *
   * This is only used if the primary message exceeds the maximum length to
   * contain both the current message and previous edit history.
   */
  static userReplyComponentsAdditionalEdits(
    messageVersions: MessageVersion[],
    emojis: StaffThreadEmojis
  ): BaseMessageOptions["components"] {
    if (messageVersions.length === 0) {
      return [];
    }

    const container = new ContainerBuilder().setAccentColor(HexColor.Purple);

    const editHistoryItems = messageVersions.map((version) => {
      const editTs = Math.floor(version.editedAt.getTime() / 1000);
      let s = `<t:${editTs}:f>`;
      s += `\n${quoteText(version.content)}`;

      return s;
    });

    let editHistoryText = `### Extended Message Edit History`;
    editHistoryText += `\n`;

    for (const item of editHistoryItems) {
      // If the edit history exceeds 4_000 characters (with some buffer), stop
      // adding more edits. Last ones are the oldest ones?

      // TODO: There is a small edge case where if they really completely max out
      // the 40000 character limit, the additional title will cause it to exceed
      // the limit, but it's unlikely.
      if (editHistoryText.length + item.length > 4000 - 100) {
        break;
      }

      editHistoryText += item + "\n";
    }

    const editTextDisplay = new TextDisplayBuilder().setContent(
      editHistoryText
    );
    container.addTextDisplayComponents(editTextDisplay);

    return [container];
  }

  /**
   * This creates the staff view message for the initial DM from a recipient.
   * This is NOT used when the user edits their DM.
   *
   * @param userMessage
   * @param emojis
   * @returns
   */
  static async userInitialReplyMessage(
    userMessage: UserToStaffMessage,
    emojis: StaffThreadEmojis
  ): Promise<MessageCreateOptions> {
    const files = await downloadAttachments(userMessage.attachments);

    const [primaryComponent] = this.userReplyComponents(
      userMessage,
      files,
      [],
      false,
      emojis
    );

    return {
      files: files,
      components: primaryComponent,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        parse: [],
      },
    };
  }
}
