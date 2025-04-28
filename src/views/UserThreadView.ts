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
import { applyStickerToEmbed, downloadAttachments } from "./util";

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
    // TODO: components v2 don't need to be re-uploaded
    const files = await downloadAttachments(msg.attachments);

    // TODO: Stickers aren't relayed for plain text
    if (options.plainText) {
      return {
        content: msg.content,
        files,
      };
    }

    const embed = new EmbedBuilder()
      .setDescription(msg.content)
      .setColor(Color.Blue)
      .setTimestamp();

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

    // Creates field + image
    applyStickerToEmbed(embed, msg.stickers);

    return {
      embeds: [embed],
      files,
    };
  }
}
