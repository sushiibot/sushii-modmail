import {
  EmbedBuilder,
  Guild,
  User,
  type ImageURLOptions,
  type MessageCreateOptions,
} from "discord.js";
import { Thread } from "../models/thread.model";
import type { StaffMessageOptions } from "services/MessageRelayService";

export interface UserThreadViewGuild {
  name: string;
  iconURL(options?: ImageURLOptions): string | null;
}

export interface UserThreadViewUser {
  tag: string;
  displayAvatarURL(): string;
}

export class UserThreadView {
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

    embed.setColor("#2F3136");

    // Set timestamp
    embed.setTimestamp();

    return {
      embeds: [embed],
    };
  }
}
