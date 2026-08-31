import {
  Client,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type PartialGroupDMChannel,
} from "discord.js";
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
  private client: Client;
  private snippetService: SnippetService;
  private threadRepository: ThreadRepository;

  private logger = getLogger("ToolbarService");

  // Serializes fold+repost per thread so two relays landing at (almost) the
  // same time don't both try to fold into the same toolbar message.
  private threadLocks = new Map<string, Promise<unknown>>();

  constructor(
    client: Client,
    snippetService: SnippetService,
    threadRepository: ThreadRepository
  ) {
    this.client = client;
    this.snippetService = snippetService;
    this.threadRepository = threadRepository;
  }

  private withThreadLock<T>(
    threadChannelId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prior = this.threadLocks.get(threadChannelId) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    // Swallow so a rejection doesn't wedge the chain for the next caller --
    // the actual error still propagates to whoever awaited `result`.
    this.threadLocks.set(
      threadChannelId,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  /**
   * Folds relayed content into the thread's current toolbar message --
   * editing it in place (attachments included) instead of posting a new
   * message -- then posts a fresh placeholder toolbar below it. Nothing is
   * ever deleted, so a reply referencing the old toolbar message never
   * turns into a "original message was deleted" ghost; it just becomes the
   * reply itself.
   *
   * Falls back to a plain send when there's no toolbar message to fold
   * into (e.g. it was already consumed by a concurrent fold, or somehow
   * missing).
   */
  async foldReply(
    threadChannelId: string,
    content: MessageCreateOptions
  ): Promise<Message> {
    return this.withThreadLock(threadChannelId, async () => {
      const fetched = await this.client.channels.fetch(threadChannelId);
      // Intentionally isTextBased(), not isSendable() -- the latter's
      // permission check relies on guild.members.me being cached, which can
      // false-negative right after a bot restart. isTextBased() is a
      // structural check only, matching the caller's existing gating.
      // Thread channels (the only kind this is ever called with) are never
      // a PartialGroupDMChannel, so this narrowing is safe.
      if (!fetched || !fetched.isTextBased()) {
        throw new Error(`Cannot send to channel: ${threadChannelId}`);
      }
      const channel = fetched as Exclude<typeof fetched, PartialGroupDMChannel>;

      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      const toolbarMessageId = thread?.toolbarMessageId ?? null;

      let folded: Message;
      if (!toolbarMessageId) {
        folded = await channel.send(content);
      } else {
        try {
          // MessageEditOptions lacks SuppressNotifications (send-only, makes
          // no sense on an edit) which MessageCreateOptions allows -- the
          // payloads passed in here never set it, so this narrowing is safe.
          folded = await channel.messages.edit(
            toolbarMessageId,
            content as MessageEditOptions
          );
        } catch (err) {
          if (
            err instanceof DiscordAPIError &&
            err.code === RESTJSONErrorCodes.UnknownMessage
          ) {
            // Toolbar message already gone somehow -- fall back so the
            // reply itself is never lost.
            folded = await channel.send(content);
          } else {
            throw err;
          }
        }

        // The old toolbar message is now permanently this reply -- clear
        // the pointer right away so nothing treats it as the live toolbar
        // while the fresh one below is being built.
        await this.threadRepository.setToolbarMessageId(threadChannelId, null);
      }

      // Also guards a fold racing with close from resurrecting a live
      // toolbar (with a still-clickable Close button) in a now-locked
      // thread -- close is irreversible, so nothing should be sent after it.
      if (!thread || thread.isClosed) {
        return folded;
      }

      try {
        await this.postFreshToolbar(channel, threadChannelId, thread.guildId);
      } catch (err) {
        // The fold already landed and must not be lost over a failed
        // repost -- the thread is left toolbar-less until the next relay,
        // whose foldReply will see no toolbarMessageId and repost then.
        this.logger.warn(
          { err, threadChannelId },
          "Failed to post fresh toolbar after folding a reply into it"
        );
      }

      return folded;
    });
  }

  /**
   * Sends the initial toolbar for a brand new thread.
   */
  async send(threadChannelId: string): Promise<void> {
    const thread = await this.threadRepository.getThreadByChannelId(
      threadChannelId
    );
    if (!thread || thread.isClosed) {
      return;
    }

    const channel = await this.client.channels.fetch(threadChannelId);
    if (!channel || !channel.isSendable()) {
      return;
    }

    await this.postFreshToolbar(channel, threadChannelId, thread.guildId);
  }

  private async postFreshToolbar(
    channel: { send(options: ReturnType<typeof ToolbarView.buildMessage>): Promise<Message> },
    threadChannelId: string,
    guildId: string
  ): Promise<void> {
    const all = await this.snippetService.getAllSnippets(guildId);
    const pinned = all
      .filter((s) => s.pinnedPosition !== null)
      .sort((a, b) => a.pinnedPosition! - b.pinnedPosition!);
    const unpinned = all.filter((s) => s.pinnedPosition === null);

    const message = await channel.send(ToolbarView.buildMessage(pinned, unpinned));
    await this.threadRepository.setToolbarMessageId(threadChannelId, message.id);
  }

  /**
   * Deletes the toolbar without sending a new one. Used on thread close --
   * foldReply's isClosed check stops anything from resurrecting it after.
   */
  async delete(threadChannelId: string): Promise<void> {
    return this.withThreadLock(threadChannelId, async () => {
      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      if (!thread) {
        return;
      }

      await this.deleteExistingMessage(threadChannelId, thread.toolbarMessageId);
      await this.threadRepository.setToolbarMessageId(threadChannelId, null);
    });
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
