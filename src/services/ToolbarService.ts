import { Client, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { getLogger } from "utils/logger";
import { ToolbarView } from "views/Toolbar";
import type { Snippet } from "models/snippet.model";

interface SnippetService {
  getAllSnippets(guildId: string): Promise<Snippet[]>;
}

interface ThreadRepository {
  getThreadByChannelId(channelId: string): Promise<{
    guildId: string;
    toolbarMessageId: string | null;
    isClosed: boolean;
  } | null>;
  setToolbarMessageId(channelId: string, messageId: string | null): Promise<void>;
}

export class ToolbarService {
  // Staff won't message-storm the way users sometimes do, so a short window
  // keeps the stale-toolbar period brief without needing batching logic.
  private static readonly RESEND_DEBOUNCE_MS = 2000;

  private client: Client;
  private snippetService: SnippetService;
  private threadRepository: ThreadRepository;

  private logger = getLogger("ToolbarService");

  // Per-thread debounce timers -- reset on each new relayed message so a
  // burst only triggers one delete+resend once things go quiet, not once
  // per message.
  private resendTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private debounceMs: number;

  constructor(
    client: Client,
    snippetService: SnippetService,
    threadRepository: ThreadRepository,
    debounceMs: number = ToolbarService.RESEND_DEBOUNCE_MS
  ) {
    this.client = client;
    this.snippetService = snippetService;
    this.threadRepository = threadRepository;
    this.debounceMs = debounceMs;
  }

  /**
   * Resets this thread's resend timer. Only once the timer elapses without
   * being reset again does the toolbar actually get deleted + resent.
   */
  scheduleResend(threadChannelId: string): void {
    const existing = this.resendTimers.get(threadChannelId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.resendTimers.delete(threadChannelId);
      this.send(threadChannelId).catch((err) =>
        this.logger.error(
          { err, threadChannelId },
          "Failed to resend toolbar after debounce"
        )
      );
    }, this.debounceMs);

    this.resendTimers.set(threadChannelId, timer);
  }

  /**
   * Deletes the current toolbar (if any) and sends a fresh one at the
   * bottom of the thread, saving its message ID for next time.
   */
  async send(threadChannelId: string): Promise<void> {
    const thread = await this.threadRepository.getThreadByChannelId(
      threadChannelId
    );
    // Also guards a resend scheduled just before close from resurrecting a
    // live toolbar (with a still-clickable Close button) in a now-locked
    // thread -- close is irreversible, so nothing should be sent after it.
    if (!thread || thread.isClosed) {
      return;
    }

    await this.deleteExistingMessage(threadChannelId, thread.toolbarMessageId);

    const all = await this.snippetService.getAllSnippets(thread.guildId);
    const pinned = all
      .filter((s) => s.pinnedPosition !== null)
      .sort((a, b) => a.pinnedPosition! - b.pinnedPosition!);
    const unpinned = all.filter((s) => s.pinnedPosition === null);

    const channel = await this.client.channels.fetch(threadChannelId);
    if (!channel || !channel.isSendable()) {
      return;
    }

    const message = await channel.send(ToolbarView.buildMessage(pinned, unpinned));
    await this.threadRepository.setToolbarMessageId(threadChannelId, message.id);
  }

  /**
   * Deletes the toolbar without sending a new one. Used on thread close --
   * there's no reopen, so nothing should be resent afterwards.
   */
  async delete(threadChannelId: string): Promise<void> {
    const existing = this.resendTimers.get(threadChannelId);
    if (existing) {
      clearTimeout(existing);
      this.resendTimers.delete(threadChannelId);
    }

    const thread = await this.threadRepository.getThreadByChannelId(
      threadChannelId
    );
    if (!thread) {
      return;
    }

    await this.deleteExistingMessage(threadChannelId, thread.toolbarMessageId);
    await this.threadRepository.setToolbarMessageId(threadChannelId, null);
  }

  private async deleteExistingMessage(
    threadChannelId: string,
    messageId: string | null
  ): Promise<void> {
    if (!messageId) {
      return;
    }

    try {
      const channel = await this.client.channels.fetch(threadChannelId);
      if (!channel || !channel.isTextBased()) {
        return;
      }

      await channel.messages.delete(messageId);
    } catch (err) {
      // Already deleted / never existed -- fine, this is best-effort cleanup.
      if (
        err instanceof DiscordAPIError &&
        (err.code === RESTJSONErrorCodes.UnknownMessage ||
          err.code === RESTJSONErrorCodes.UnknownChannel)
      ) {
        return;
      }

      this.logger.warn(
        { err, threadChannelId, messageId },
        "Failed to delete existing toolbar message"
      );
    }
  }
}
