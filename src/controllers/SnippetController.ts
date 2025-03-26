import { Client, Message } from "discord.js";
import { getLogger } from "../utils/logger";
import type { Logger } from "pino";
import type { StaffMessageOptions } from "../services/MessageRelayService";
import type {
  UserThreadViewGuild,
  UserThreadViewUser,
} from "views/UserThreadView";
import { StaffThreadView } from "views/StaffThreadView";

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

export interface MessageRelayService {
  relayStaffMessageToUser(
    userId: string,
    guild: UserThreadViewGuild,
    staffUser: UserThreadViewUser,
    content: string,
    options?: StaffMessageOptions
  ): Promise<void>;
}

export class SnippetController {
  private prefix: string;
  private snippetService: SnippetService;
  private threadService: ThreadService;
  private messageService: MessageRelayService;

  private logger: Logger = getLogger(this.constructor.name);

  constructor(
    prefix: string,
    snippetService: SnippetService,
    threadService: ThreadService,
    messageService: MessageRelayService
  ) {
    this.prefix = prefix;
    this.snippetService = snippetService;
    this.threadService = threadService;
    this.messageService = messageService;
  }

  async handleThreadMessage(client: Client, message: Message): Promise<void> {
    try {
      // Skip if not starting with the snippet prefix '-'
      if (!message.content.startsWith(this.prefix) || message.author.bot) {
        return;
      }

      if (!message.channel.isSendable()) {
        return;
      }

      // Check if this is a modmail thread
      const thread = await this.threadService.getThreadByChannelId(
        message.channel.id
      );

      if (!thread) {
        this.logger.debug(
          `Ignoring message in non-thread channel: ${message.channel.id}`
        );
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
        anonymous: message.content.includes("-a"),
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

      await this.messageService.relayStaffMessageToUser(
        thread.userId,
        guild,
        message.author,
        snippet.content,
        options
      );

      // Re-send as embed to show the message was sent and how it looks
      const embed = StaffThreadView.staffReplyEmbed(
        message.author,
        snippet.content,
        options
      );

      await Promise.allSettled([
        // Delete the original message
        message.delete(),
        message.channel.send({
          embeds: [embed],
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
