import { Client, Message, MessageFlags } from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";
import type { StaffMessageOptions } from "../services/MessageRelayService";
import type {
  UserThreadViewGuild,
  UserThreadViewUser,
} from "views/UserThreadView";
import { StaffThreadView } from "views/StaffThreadView";

interface Config {
  prefix: string;
  forumChannelId: string;
  anonymousSnippets: boolean;
}

export interface Thread {
  userId: string;
  channelId: string;
  guildId: string;
}

export interface Snippet {
  guildId: string;
  name: string;
  content: string;
}

export interface SnippetService {
  getSnippet(guildId: string, name: string): Promise<Snippet | null>;
}

export interface ThreadService {
  getThreadByChannelId(channelId: string): Promise<Thread | null>;
}

import type { StaffToUserMessage } from "../models/relayMessage";

export interface MessageRelayService {
  relayStaffMessageToUser(
    userId: string,
    guild: UserThreadViewGuild,
    msg: StaffToUserMessage,
    options?: StaffMessageOptions
  ): Promise<{ msgId: string; dmChannelId: string }>;
}

export class SnippetController {
  private config: Config;

  private snippetService: SnippetService;
  private threadService: ThreadService;
  private messageService: MessageRelayService;

  private logger: Logger = getLogger(this.constructor.name);

  constructor(
    config: Config,
    snippetService: SnippetService,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    this.config = config;
    this.snippetService = snippetService;
    this.threadService = threadService;
    this.messageService = messageService;
  }

  async handleThreadMessage(client: Client, message: Message): Promise<void> {
    try {
      if (!message.channel.isThread()) {
        return;
      }

      // Check if this is the modmail channel
      if (message.channel.parentId !== this.config.forumChannelId) {
        return;
      }

      // Skip if not starting with the snippet prefix '-'
      if (
        !message.content.startsWith(this.config.prefix) ||
        message.author.bot
      ) {
        return;
      }

      // Find modmail thread
      const thread = await this.threadService.getThreadByChannelId(
        message.channel.id
      );

      if (!thread) {
        return;
      }

      // Extract snippet name (removing the `-` prefix)
      const snippetName = message.content.slice(1).trim().split(/\s+/)[0];

      if (!snippetName) {
        return;
      }

      this.logger.debug(
        `Looking for snippet: ${snippetName} in guild ${thread.guildId}`
      );

      // Get the snippet
      const snippet = await this.snippetService.getSnippet(
        thread.guildId,
        snippetName
      );

      if (!snippet) {
        // Ignore
        this.logger.debug(`Snippet not found: ${snippetName}`);
        return;
      }

      // Get the guild
      const guild = client.guilds.cache.get(thread.guildId);
      if (!guild) {
        throw new Error(`Guild not found: ${thread.guildId}`);
      }

      // Relay the snippet content to the user
      const options: StaffMessageOptions = {
        anonymous: this.config.anonymousSnippets,
        plainText: message.content.includes("-p"),
        snippet: true,
      };

      this.logger.debug(
        {
          snippet: snippetName,
          userId: thread.userId,
          options,
        },
        `Sending snippet to user`
      );

      // Override the message content with the snippet content before relaying
      message.content = snippet.content;

      await this.messageService.relayStaffMessageToUser(
        thread.userId,
        guild,
        {
          ...message,
          attachments: Array.from(message.attachments.values()),
          stickers: Array.from(message.stickers.values()),
        },
        options
      );

      // Re-send to show the message was sent and how it looks
      const components = StaffThreadView.staffReplyComponents(
        {
          ...message,
          attachments: Array.from(message.attachments.values()),
          stickers: Array.from(message.stickers.values()),
        },
        options
      );

      await Promise.allSettled([
        // Delete the original message
        message.delete(),
        message.channel.send({
          components,
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        }),
      ]);
    } catch (err) {
      this.logger.error(err, `Error handling snippet command`);
      await message.reply(
        "An error occurred while processing the snippet command."
      );
    }
  }
}
