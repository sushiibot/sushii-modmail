import {
  ContainerBuilder,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type BaseMessageOptions,
  type Client,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type PartialGroupDMChannel,
} from "discord.js";
import { getLogger } from "utils/logger";
import { ToolbarView } from "views/Toolbar";
import { extractComponentImages } from "views/util";
import { StaffThreadEmojis, StaffThreadView } from "views/StaffThreadView";
import type { Snippet } from "models/snippet.model";
import type { Message as MessageModel } from "models/message.model";
import type { MessageVersion } from "models/messageVersion.model";
import type { BotEmojiRepository } from "repositories/botEmoji.repository";

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

interface MessageRepository {
  getByThreadMessageId(messageId: string): Promise<MessageModel | null>;
  getMessageVersions(messageId: string): Promise<MessageVersion[]>;
}

type SendableChannel = {
  send(options: MessageCreateOptions): Promise<Message>;
  messages: {
    fetch(id: string): Promise<Message>;
    edit(id: string, options: MessageEditOptions): Promise<Message>;
    delete(id: string): Promise<unknown>;
  };
};

// Discord caps a message at 40 total components, nested included. Counted
// conservatively (every node with a `type`, plus nested components/items/
// options) so the guard fires early rather than risking a rejected send.
const CV2_COMPONENT_BUDGET = 40;

function countComponents(nodes: unknown[]): number {
  let count = 0;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const obj = node as Record<string, unknown>;
    if ("type" in obj) {
      count++;
    }
    for (const key of ["components", "items", "options"]) {
      if (Array.isArray(obj[key])) {
        (obj[key] as unknown[]).forEach(walk);
      }
    }
    if (obj.accessory) {
      walk(obj.accessory);
    }
    if (obj.thumbnail) {
      walk(obj.thumbnail);
    }
  };

  for (const node of nodes) {
    const json =
      node && typeof node === "object" && "toJSON" in node
        ? (node as { toJSON(): unknown }).toJSON()
        : node;
    walk(json);
  }

  return count;
}

function wouldExceedComponentBudget(nodes: unknown[]): boolean {
  return countComponents(nodes) > CV2_COMPONENT_BUDGET;
}

/**
 * Pure overlay composition: the toolbar rides as its own top-level CV2
 * container appended after whatever the message is actually about. Views
 * never see the toolbar -- this is the only place base components and the
 * toolbar are combined.
 */
export function withToolbar<T>(
  baseComponents: readonly T[],
  toolbar: ContainerBuilder
): (T | ContainerBuilder)[] {
  return [...baseComponents, toolbar];
}

function isUnknownMessage(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;
}

export class ToolbarService {
  private client: Client;
  private snippetService: SnippetService;
  private threadRepository: ThreadRepository;
  private messageRepository: MessageRepository;
  private emojiRepository: Pick<BotEmojiRepository, "getEmojiMap">;

  private logger = getLogger("ToolbarService");

  // Serializes relay/strip/close/refresh per thread so two of them landing
  // at (almost) the same time don't race over which message currently
  // wears the toolbar.
  private threadLocks = new Map<string, Promise<unknown>>();

  constructor(
    client: Client,
    snippetService: SnippetService,
    threadRepository: ThreadRepository,
    messageRepository: MessageRepository,
    emojiRepository: Pick<BotEmojiRepository, "getEmojiMap">
  ) {
    this.client = client;
    this.snippetService = snippetService;
    this.threadRepository = threadRepository;
    this.messageRepository = messageRepository;
    this.emojiRepository = emojiRepository;
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

  private async fetchChannel(threadChannelId: string): Promise<SendableChannel> {
    const fetched = await this.client.channels.fetch(threadChannelId);
    // Intentionally isTextBased(), not isSendable() -- the latter's
    // permission check relies on guild.members.me being cached, which can
    // false-negative right after a bot restart. isTextBased() is a
    // structural check only, matching the caller's existing gating. Thread
    // channels (the only kind this is ever called with) are never a
    // PartialGroupDMChannel, so this narrowing is safe.
    if (!fetched || !fetched.isTextBased()) {
      throw new Error(`Cannot send to channel: ${threadChannelId}`);
    }
    return fetched as unknown as Exclude<typeof fetched, PartialGroupDMChannel> &
      SendableChannel;
  }

  private async getToolbarPieces(
    guildId: string
  ): Promise<{ full: MessageCreateOptions; container: ContainerBuilder }> {
    const all = await this.snippetService.getAllSnippets(guildId);
    const pinned = all
      .filter((s) => s.pinnedPosition !== null)
      .sort((a, b) => a.pinnedPosition! - b.pinnedPosition!);
    const unpinned = all.filter((s) => s.pinnedPosition === null);

    const full = ToolbarView.buildMessage(pinned, unpinned);
    return { full, container: full.components![0] as ContainerBuilder };
  }

  /**
   * Re-renders a persisted message's own components, with NO toolbar
   * appended -- dispatches on isStaff to the matching view function. Fed by
   * fresh attachment/sticker URLs extracted from the live Discord message
   * (never the stored DB URLs, which are signed and expire) plus the
   * message's own createdTimestamp.
   */
  private async renderMessageBase(
    row: MessageModel,
    attachmentUrls: string[],
    stickers: { name: string; url: string }[],
    createdTimestamp: number
  ): Promise<BaseMessageOptions["components"]> {
    const emojis = await this.emojiRepository.getEmojiMap(StaffThreadEmojis);
    const author = await this.client.users.fetch(row.authorId);

    if (row.isStaff()) {
      return StaffThreadView.staffReplyComponents(
        {
          id: row.messageId,
          author,
          content: row.content,
          attachments: attachmentUrls,
          stickers,
          forwarded: row.forwarded,
          createdTimestamp,
        },
        emojis,
        {
          anonymous: row.isAnonymous,
          plainText: row.isPlainText,
          snippet: row.isSnippet,
        },
        {
          failed: row.dmFailed ?? undefined,
          editedById: row.editedById ?? undefined,
          // deletedById isn't persisted (only known at the moment of the
          // delete interaction) -- a strip of a deleted message loses that
          // attribution badge. Flagged as a known gap, not resolved here.
        }
      );
    }

    const messageVersions = await this.messageRepository.getMessageVersions(
      row.messageId
    );
    // Derived, not persisted -- "has this message ever been edited" is
    // exactly "does it have any versions".
    const isEdited = messageVersions.length > 0;

    const [primary] = StaffThreadView.userReplyComponents(
      {
        id: row.messageId,
        author,
        content: row.content ?? "",
        forwarded: row.forwarded,
        createdTimestamp,
        // Names aren't persisted for user attachments (only bare URLs
        // are), so this is a best-effort filename derived from the URL --
        // only ever shown in the isEdited-gated "Original Attachment
        // links" block, which a genuinely edited message already skips.
        attachments: attachmentUrls.map((url) => ({
          name: filenameFromUrl(url),
          url,
        })),
        stickers,
      },
      attachmentUrls,
      messageVersions,
      isEdited,
      emojis
    );

    return primary;
  }

  /**
   * Strips the toolbar off a previous bearer by re-rendering it from its
   * stored model (no wire-splicing) and editing it in place. Never throws --
   * the relay/refresh/close that triggered this already landed and must not
   * be lost over a best-effort cleanup failing.
   */
  private async stripBearer(
    channel: SendableChannel,
    threadChannelId: string,
    bearerId: string
  ): Promise<void> {
    try {
      const row = await this.messageRepository.getByThreadMessageId(bearerId);

      if (!row) {
        // No DB row means this bearer was never a relayed message -- either
        // the standalone initial toolbar (ToolbarService.send) or a
        // budget-guard fallback toolbar. Both are toolbar-only, so there's
        // nothing to preserve; just remove it.
        await channel.messages.delete(bearerId);
        return;
      }

      const fetched = await channel.messages.fetch(bearerId);
      const { attachmentUrls, stickers } = extractComponentImages(fetched);
      const base = await this.renderMessageBase(
        row,
        attachmentUrls,
        stickers,
        fetched.createdTimestamp
      );

      await channel.messages.edit(bearerId, {
        components: base,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      if (isUnknownMessage(err)) {
        return;
      }

      this.logger.warn(
        { err, threadChannelId, bearerId },
        "Failed to strip toolbar overlay off previous bearer message"
      );
    }
  }

  /**
   * Relays content to the thread as a real, new message (fires a
   * notification, lands at the bottom) with the toolbar composed on top as
   * an overlay, then strips the overlay off whatever the previous bearer
   * was. Nothing is ever deleted except a toolbar-only bearer (see
   * stripBearer), so a reply referencing an old bearer degrades to a
   * normal (non-toolbar) message instead of a "message was deleted" ghost.
   */
  async relay(
    threadChannelId: string,
    content: MessageCreateOptions
  ): Promise<Message> {
    return this.withThreadLock(threadChannelId, async () => {
      const channel = await this.fetchChannel(threadChannelId);
      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      const previousBearerId = thread?.toolbarMessageId ?? null;

      // Guards a relay racing with close from resurrecting a live toolbar
      // (with a still-clickable Close button) in a now-locked thread --
      // close is irreversible, so nothing should be sent after it.
      if (!thread || thread.isClosed) {
        return channel.send(content);
      }

      const { full: toolbarMessage, container: toolbarContainer } =
        await this.getToolbarPieces(thread.guildId);
      const baseComponents = content.components ?? [];

      let sent: Message;
      let newBearerId: string;

      if (wouldExceedComponentBudget([...baseComponents, toolbarContainer])) {
        // Composing would exceed CV2's 40-component cap and Discord would
        // reject the whole send -- fall back to two messages so the
        // relayed content is never lost.
        sent = await channel.send(content);
        const toolbarMsg = await channel.send(toolbarMessage);
        newBearerId = toolbarMsg.id;
      } else {
        sent = await channel.send({
          ...content,
          components: withToolbar(baseComponents, toolbarContainer),
        });
        newBearerId = sent.id;
      }

      await this.threadRepository.setToolbarMessageId(
        threadChannelId,
        newBearerId
      );

      if (previousBearerId && previousBearerId !== newBearerId) {
        await this.stripBearer(channel, threadChannelId, previousBearerId);
      }

      return sent;
    });
  }

  /**
   * Sends the initial toolbar for a brand new thread. Standalone (no base
   * message to overlay onto yet), so it has no DB row -- stripBearer treats
   * that as toolbar-only and deletes it outright once superseded.
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

    const { full } = await this.getToolbarPieces(thread.guildId);
    const message = await channel.send(full);
    await this.threadRepository.setToolbarMessageId(threadChannelId, message.id);
  }

  /**
   * Appends the toolbar overlay to `baseEditOptions` iff `messageId` is the
   * thread's current bearer, otherwise returns it unchanged. Wired into the
   * edit/delete-sync paths so re-rendering a message that happens to be the
   * bearer doesn't silently strip the toolbar off it.
   */
  async reapplyIfBearer(
    threadChannelId: string,
    messageId: string,
    baseEditOptions: MessageEditOptions
  ): Promise<MessageEditOptions> {
    return this.withThreadLock(threadChannelId, async () => {
      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      if (!thread || thread.isClosed) {
        return baseEditOptions;
      }
      if (thread.toolbarMessageId !== messageId) {
        return baseEditOptions;
      }

      const { container } = await this.getToolbarPieces(thread.guildId);
      const baseComponents = baseEditOptions.components ?? [];

      if (wouldExceedComponentBudget([...baseComponents, container])) {
        // Leave it stripped rather than throwing and losing the edit --
        // the next relay's fresh send will re-establish a bearer.
        return baseEditOptions;
      }

      return {
        ...baseEditOptions,
        components: withToolbar(baseComponents, container),
        flags: MessageFlags.IsComponentsV2,
      };
    });
  }

  /**
   * Re-composes the overlay on the current bearer in place (e.g. after a
   * pin edit changes the toolbar's snippet buttons). The bearer also carries
   * real message content now, so this re-renders that content from its
   * model rather than overwriting it with toolbar-only components.
   */
  async refresh(threadChannelId: string): Promise<void> {
    return this.withThreadLock(threadChannelId, async () => {
      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      if (!thread || thread.isClosed) {
        return;
      }

      const channel = await this.fetchChannel(threadChannelId);
      const { full, container } = await this.getToolbarPieces(thread.guildId);

      if (thread.toolbarMessageId) {
        try {
          const fetched = await channel.messages.fetch(thread.toolbarMessageId);
          const row = await this.messageRepository.getByThreadMessageId(
            thread.toolbarMessageId
          );

          let base: NonNullable<BaseMessageOptions["components"]> = [];
          if (row) {
            const { attachmentUrls, stickers } = extractComponentImages(fetched);
            base =
              (await this.renderMessageBase(
                row,
                attachmentUrls,
                stickers,
                fetched.createdTimestamp
              )) ?? [];
          }

          const combined = wouldExceedComponentBudget([...base, container])
            ? base
            : withToolbar(base, container);

          await channel.messages.edit(thread.toolbarMessageId, {
            components: combined,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
          });
          return;
        } catch (err) {
          if (!isUnknownMessage(err)) {
            throw err;
          }
          // Bearer message gone -- fall through and post a fresh toolbar.
        }
      }

      const message = await channel.send(full);
      await this.threadRepository.setToolbarMessageId(threadChannelId, message.id);
    });
  }

  /**
   * Strips the overlay off the bearer on thread close instead of deleting a
   * standalone toolbar -- the bearer is a real relayed message now, so
   * deleting it would destroy that content. No new send: there's no reopen,
   * so nothing should be sent after close.
   */
  async close(threadChannelId: string): Promise<void> {
    return this.withThreadLock(threadChannelId, async () => {
      const thread = await this.threadRepository.getThreadByChannelId(
        threadChannelId
      );
      if (!thread) {
        return;
      }

      if (thread.toolbarMessageId) {
        const channel = await this.fetchChannel(threadChannelId);
        await this.stripBearer(channel, threadChannelId, thread.toolbarMessageId);
      }

      await this.threadRepository.setToolbarMessageId(threadChannelId, null);
    });
  }
}

function filenameFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0];
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1] || "attachment";
}
