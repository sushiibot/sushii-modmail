import {
  EmbedBuilder,
  type ImageURLOptions,
  type MessageCreateOptions,
} from "discord.js";
import type { StaffMessageOptions } from "services/MessageRelayService";
import { Color } from "./Color";

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
      .setColor(Color.Blue)
      .setTimestamp();

    return {
      embeds: [embed],
    };
  }

  static staffMessage(
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options: StaffMessageOptions = {}
  ): MessageCreateOptions {
    if (options.plainText) {
      return {
        content,
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
        name: staffUser.tag,
        iconURL: staffUser.displayAvatarURL(),
      });
    }

    // Set the content
    embed.setDescription(content);

    embed.setColor(Color.Blue);

    // Set timestamp
    embed.setTimestamp();

    return {
      embeds: [embed],
    };
  }
}
