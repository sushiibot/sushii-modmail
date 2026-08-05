import {
  PermissionsBitField,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import TextCommandHandler from "commands/CommandHandler";
import { getLogger } from "utils/logger";
import { SayService } from "services/SayService";
import { SayCommandView } from "views/Say";

const SNOWFLAKE_RE = /^\d{17,20}$/;

const REQUIRED_PERMISSIONS = new PermissionsBitField([
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
]);

type ChannelResolution =
  | { ok: true; channel: GuildTextBasedChannel }
  | { ok: false; reason: "not_found" | "not_sendable" };

export class SayCommand extends TextCommandHandler {
  commandName = "say";
  subCommandName = null;
  aliases = [];
  requiresPrimaryServer = true;

  private sayService: SayService;
  private logger = getLogger(this.constructor.name);

  constructor(sayService: SayService) {
    super();
    this.sayService = sayService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      return;
    }

    const resolution = await this.resolveTargetChannel(msg, args[0]);

    if (!resolution.ok) {
      if (resolution.reason === "not_found") {
        await msg.reply(SayCommandView.channelNotFound());
      } else {
        await msg.reply(SayCommandView.channelNotSendable());
      }
      return;
    }

    try {
      await this.sayService.promptCompose(msg, resolution.channel);
    } catch (error) {
      this.logger.error(`Error starting say command: ${error}`);
      await msg.reply(SayCommandView.errorStarting());
    }
  }

  private async resolveTargetChannel(
    msg: Message<true>,
    arg: string | undefined
  ): Promise<ChannelResolution> {
    let channel: GuildTextBasedChannel | null = null;

    if (arg) {
      const mentioned = msg.mentions.channels.first();
      if (mentioned && !mentioned.isDMBased() && mentioned.isTextBased()) {
        channel = mentioned;
      } else if (SNOWFLAKE_RE.test(arg)) {
        const resolved = msg.guild.channels.cache.get(arg);
        if (resolved && resolved.isTextBased()) {
          channel = resolved;
        }
      }

      if (!channel) {
        return { ok: false, reason: "not_found" };
      }
    } else if (msg.channel.isTextBased() && !msg.channel.isDMBased()) {
      channel = msg.channel;
    }

    if (!channel) {
      return { ok: false, reason: "not_found" };
    }

    const botMember = await msg.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    if (!permissions.has(REQUIRED_PERMISSIONS)) {
      return { ok: false, reason: "not_sendable" };
    }

    return { ok: true, channel };
  }
}
