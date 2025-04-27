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
import type { RelayMessageCreate } from "./StaffThreadView";
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
    msg: RelayMessageCreate,
    options: StaffMessageOptions = defaultStaffMessageOptions
  ): Promise<MessageCreateOptions> {
    // Re-upload attachments
    const files = await downloadAttachments(msg.attachments);

    // TODO: Stickers aren't relayed for plain text
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

    // Relay stickers
    if (msg.stickers.size > 0) {
      const sticker = msg.stickers.first()!;

      embed.setImage(sticker.url);

      const stickerDisplay = `[${sticker.name}](${sticker.url})`;
      embed.addFields({
        name: "Sticker",
        value: stickerDisplay,
      });
    }

    return {
      embeds: [embed],
      files,
    };
  }
}
