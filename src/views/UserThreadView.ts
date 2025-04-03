import {
  EmbedBuilder,
  type ImageURLOptions,
  type MessageCreateOptions,
} from "discord.js";
import {
  defaultStaffMessageOptions,
  type StaffMessageOptions,
} from "services/MessageRelayService";
import { Color } from "./Color";
import type { RelayMessage } from "./StaffThreadView";
import {
  createAttachmentField,
  createStickerField,
  downloadAttachments,
} from "./util";

export interface UserThreadViewGuild {
  name: string;
  iconURL(options?: ImageURLOptions): string | null;
}

export interface UserThreadViewUser {
  tag: string;
  displayAvatarURL(): string;
}

export class UserThreadView {
  static initialMessage(
    guild: UserThreadViewGuild,
    message: string
  ): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: guild.name,
        iconURL: guild.iconURL() || undefined,
      })
      .setDescription(message)
      .setColor(Color.Gray)
      .setFooter({
        text: "Automated message",
      })
      .setTimestamp();

    return {
      embeds: [embed],
    };
  }

  static async staffMessage(
    guild: UserThreadViewGuild,
    msg: RelayMessage,
    options: StaffMessageOptions = defaultStaffMessageOptions
  ): Promise<MessageCreateOptions> {
    // Re-upload attachments
    const files = await downloadAttachments(msg.attachments);

    // TODO: Stickers aren't relayed
    if (options.plainText) {
      return {
        content: msg.content,
        files,
      };
    }

    const embed = new EmbedBuilder();

    if (options.anonymous) {
      embed.setAuthor({
        name: guild.name,
        iconURL: guild.iconURL() || undefined,
      });
    } else {
      embed.setAuthor({
        name: msg.author.displayName,
        iconURL: msg.author.displayAvatarURL(),
      });
    }

    embed.setDescription(msg.content).setColor(Color.Blue).setTimestamp();

    return {
      embeds: [embed],
      files,
    };
  }
}
