import {
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type Message,
  type ModalMessageModalSubmitInteraction,
} from "discord.js";
import { getLogger } from "utils/logger";
import {
  isToolbarCustomId,
  parsePinnedSnippetCustomId,
  parseSnippetModalCustomId,
  PIN_SLOT_COUNT,
  toolbarCustomID,
  ToolbarView,
} from "views/Toolbar";
import type { RuntimeConfig } from "models/runtimeConfig.model";
import type { Snippet } from "models/snippet.model";
import type { StaffMessageOptions } from "services/MessageRelayService";
import type { StaffToUserMessage } from "models/relayMessage";
import type { UserThreadViewGuild } from "views/UserThreadView";
import { hasStaffPermission } from "utils/permissions";

const NO_PERMISSION_MESSAGE = "You don't have permission to use this.";

interface Thread {
  userId: string;
  channelId: string;
  guildId: string;
  isClosed: boolean;
  toolbarMessageId: string | null;
}

interface ThreadService {
  getThreadByChannelId(channelId: string): Promise<Thread | null>;
  closeThread(thread: Thread, userId: string): Promise<void>;
}

interface MessageRelayService {
  relayStaffMessageToUser(
    threadId: string,
    userId: string,
    guild: UserThreadViewGuild,
    msg: StaffToUserMessage,
    options: StaffMessageOptions
  ): Promise<void>;
}

interface SnippetService {
  getSnippet(guildId: string, name: string): Promise<Snippet | null>;
  getAllSnippets(guildId: string): Promise<Snippet[]>;
  setPinnedPosition(guildId: string, name: string, position: number): Promise<void>;
  clearPinnedPosition(guildId: string, name: string): Promise<void>;
}

interface ToolbarService {
  send(threadChannelId: string): Promise<void>;
  refresh(threadChannelId: string): Promise<void>;
}

interface ConfigRepository {
  getConfig(guildId: string): Promise<RuntimeConfig>;
}

export class ToolbarController {
  private threadService: ThreadService;
  private messageService: MessageRelayService;
  private snippetService: SnippetService;
  private toolbarService: ToolbarService;
  private configRepository: ConfigRepository;

  private logger = getLogger(this.constructor.name);

  constructor(
    threadService: ThreadService,
    messageService: MessageRelayService,
    snippetService: SnippetService,
    toolbarService: ToolbarService,
    configRepository: ConfigRepository
  ) {
    this.threadService = threadService;
    this.messageService = messageService;
    this.snippetService = snippetService;
    this.toolbarService = toolbarService;
    this.configRepository = configRepository;
  }

  /**
   * Every privileged toolbar entry point (buttons, select menus, modals, and
   * the reply-to-toolbar shortcut) must pass the same staff-permission check
   * CommandRouter enforces for text commands -- otherwise anyone who can
   * merely see/click in the thread channel could bypass a guild's
   * configured requiredRoleIds via the toolbar even though the equivalent
   * text command would refuse them.
   */
  private hasPermission(
    guildId: string,
    member: Parameters<typeof hasStaffPermission>[2]
  ): Promise<boolean> {
    return hasStaffPermission(this.configRepository, guildId, member);
  }

  /**
   * True if `message` is a reply targeting the toolbar itself -- the
   * disambiguator that lets the command word skip the usual prefix. A reply
   * to a regular relayed message is intentionally NOT handled here, so
   * staff can freely quote/discuss messages internally without triggering
   * any bot behavior.
   */
  isReplyToToolbar(message: Message, thread: Thread): boolean {
    const referencedId = message.reference?.messageId;
    return !!referencedId && referencedId === thread.toolbarMessageId;
  }

  async handleButton(interaction: ButtonInteraction<"cached">): Promise<void> {
    const { customId } = interaction;

    if (!(await this.hasPermission(interaction.guildId, interaction.member))) {
      await interaction.reply({ content: NO_PERMISSION_MESSAGE, ephemeral: true });
      return;
    }

    if (customId === toolbarCustomID.reply) {
      await interaction.showModal(ToolbarView.replyModal(false));
      return;
    }

    if (customId === toolbarCustomID.anonReply) {
      await interaction.showModal(ToolbarView.replyModal(true));
      return;
    }

    if (customId === toolbarCustomID.close) {
      // A misclick among a row of buttons is the real accident risk here
      // (unlike typing "close" as a reply or text command, which already
      // requires deliberate action) -- and there's no reopen, so this is
      // the one toolbar action worth an extra step. The confirm/cancel
      // buttons live on this ephemeral reply, not the toolbar itself, so
      // confirming/cancelling never touches the shared message.
      await interaction.reply(ToolbarView.closeConfirmMessage());
      return;
    }

    if (customId === toolbarCustomID.confirmClose) {
      await interaction.deferUpdate();
      const thread = await this.threadService.getThreadByChannelId(
        interaction.channelId
      );
      if (!thread || thread.isClosed) {
        await interaction.editReply(
          ToolbarView.closeResultMessage("This thread is already closed.")
        );
        return;
      }
      await this.threadService.closeThread(thread, interaction.user.id);
      await interaction.editReply(ToolbarView.closeResultMessage("Thread closed."));
      return;
    }

    if (customId === toolbarCustomID.cancelClose) {
      await interaction.deferUpdate();
      await interaction.deleteReply();
      return;
    }

    if (customId === toolbarCustomID.editPins) {
      const thread = await this.threadService.getThreadByChannelId(
        interaction.channelId
      );
      if (!thread) {
        return;
      }
      const allSnippets = await this.snippetService.getAllSnippets(
        thread.guildId
      );
      await interaction.reply({
        ...ToolbarView.pinsEditorMessage(allSnippets),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    const pinnedSnippetName = parsePinnedSnippetCustomId(customId);
    if (pinnedSnippetName !== null) {
      await interaction.deferUpdate();
      await this.sendPinnedSnippet(interaction, pinnedSnippetName);
      return;
    }

    this.logger.warn({ customId }, "Unknown toolbar button interaction");
  }

  /**
   * Pinned buttons send instantly, no preview -- frequency = familiarity,
   * so the confirmation step that the snippet dropdown gets (a pre-filled
   * modal) would just be friction for a snippet staff already know by heart.
   */
  private async sendPinnedSnippet(
    interaction: ButtonInteraction<"cached">,
    snippetName: string
  ): Promise<void> {
    const thread = await this.threadService.getThreadByChannelId(
      interaction.channelId
    );
    if (!thread || thread.isClosed) {
      return;
    }

    const snippet = await this.snippetService.getSnippet(
      thread.guildId,
      snippetName
    );
    if (!snippet) {
      return;
    }

    await this.sendSnippet(interaction, thread, snippet);
  }

  /**
   * Shared by the pinned-button path and the oversized-snippet direct-send
   * path (dropdown selections that are too long to preview/edit in a
   * modal) -- both relay a snippet's content unmodified using the guild's
   * anonymousSnippets setting.
   */
  private async sendSnippet(
    interaction: {
      id: string;
      user: { id: string; username: string; displayName: string; displayAvatarURL(): string };
      guild: UserThreadViewGuild;
      createdTimestamp: number;
    },
    thread: Thread,
    snippet: Snippet
  ): Promise<void> {
    const config = await this.configRepository.getConfig(thread.guildId);

    await this.messageService.relayStaffMessageToUser(
      thread.channelId,
      thread.userId,
      interaction.guild,
      {
        id: interaction.id,
        author: interaction.user,
        content: snippet.content,
        attachments: [],
        stickers: [],
        forwarded: false,
        createdTimestamp: interaction.createdTimestamp,
      },
      {
        anonymous: config.anonymousSnippets,
        plainText: false,
        snippet: true,
        snippetName: snippet.name,
      }
    );
  }

  async handleSelectMenu(
    interaction: AnySelectMenuInteraction<"cached">
  ): Promise<void> {
    const { customId } = interaction;

    if (!(await this.hasPermission(interaction.guildId, interaction.member))) {
      await interaction.reply({ content: NO_PERMISSION_MESSAGE, ephemeral: true });
      return;
    }

    if (customId === toolbarCustomID.snippetSelect) {
      const thread = await this.threadService.getThreadByChannelId(
        interaction.channelId
      );
      if (!thread) {
        return;
      }

      const name = interaction.values[0];
      const snippet = await this.snippetService.getSnippet(
        thread.guildId,
        name
      );
      if (!snippet) {
        await interaction.reply({
          content: `Snippet \`${name}\` no longer exists.`,
          ephemeral: true,
        });
        return;
      }

      // The modal's text input hard-caps at 4000 chars, silently truncating
      // anything longer on prefill. Rather than let staff unknowingly send
      // a clipped version, skip the modal for an oversized snippet and send
      // it unmodified -- same as a pinned button, just without the preview.
      if (snippet.content.length > 4000) {
        await interaction.deferReply({ ephemeral: true });
        await this.sendSnippet(interaction, thread, snippet);
        await interaction.editReply(
          "Snippet is too long to preview/edit -- sent as-is."
        );
        return;
      }

      await interaction.showModal(ToolbarView.snippetModal(snippet));
      return;
    }

    for (let slot = 1; slot <= PIN_SLOT_COUNT; slot++) {
      if (customId !== toolbarCustomID.pinSlot(slot)) {
        continue;
      }

      const thread = await this.threadService.getThreadByChannelId(
        interaction.channelId
      );
      if (!thread) {
        return;
      }

      const selectedName = interaction.values[0];
      const allSnippets = await this.snippetService.getAllSnippets(
        thread.guildId
      );
      const currentlyInSlot = allSnippets.find((s) => s.pinnedPosition === slot);

      if (selectedName) {
        await this.snippetService.setPinnedPosition(
          thread.guildId,
          selectedName,
          slot
        );
      } else if (currentlyInSlot) {
        await this.snippetService.clearPinnedPosition(
          thread.guildId,
          currentlyInSlot.name
        );
      }

      const refreshedSnippets = await this.snippetService.getAllSnippets(
        thread.guildId
      );
      await interaction.update(
        ToolbarView.pinsEditorMessage(refreshedSnippets)
      );

      // Refresh the live toolbar immediately -- pin edits are deliberate and
      // infrequent, so immediate feedback beats waiting for the next message.
      await this.toolbarService.refresh(interaction.channelId);
      return;
    }

    this.logger.warn({ customId }, "Unknown toolbar select menu interaction");
  }

  async handleModalSubmit(
    interaction: ModalMessageModalSubmitInteraction<"cached">
  ): Promise<void> {
    const { customId } = interaction;

    if (!isToolbarCustomId(customId)) {
      // Not ours -- another modal controller (settings, say, etc.) owns
      // this submission, called unconditionally per the existing pattern.
      return;
    }

    if (!(await this.hasPermission(interaction.guildId, interaction.member))) {
      await interaction.reply({ content: NO_PERMISSION_MESSAGE, ephemeral: true });
      return;
    }

    if (
      customId === toolbarCustomID.modalReply ||
      customId === toolbarCustomID.modalAnonReply
    ) {
      // deferReply (not deferUpdate) deliberately doesn't reference the
      // origin toolbar message -- staff can spend a while composing in the
      // modal, and the debounced resend may have deleted that message by
      // the time they submit. deferUpdate() against a deleted message would
      // silently drop the reply with no feedback. On success this deferred
      // reply is just deleted (the folded message already shows the reply
      // went out); on failure it's edited to explain why, since that's the
      // only place staff would see it.
      await interaction.deferReply({ ephemeral: true });

      const thread = await this.threadService.getThreadByChannelId(
        interaction.channelId
      );
      if (!thread || thread.isClosed) {
        await interaction.editReply(
          "This thread is closed -- your reply was not sent."
        );
        return;
      }

      const content = interaction.fields.getTextInputValue(
        toolbarCustomID.modalReplyInput
      );

      await this.messageService.relayStaffMessageToUser(
        thread.channelId,
        thread.userId,
        interaction.guild,
        {
          id: interaction.id,
          author: interaction.user,
          content,
          attachments: [],
          stickers: [],
          forwarded: false,
          createdTimestamp: interaction.createdTimestamp,
        },
        {
          anonymous: customId === toolbarCustomID.modalAnonReply,
          plainText: false,
          snippet: false,
        }
      );
      // No visible confirmation needed -- the fold above already shows the
      // reply in the channel, so this deferred ack just gets discarded.
      await interaction.deleteReply();
      return;
    }

    const snippetName = parseSnippetModalCustomId(customId);
    if (snippetName !== null) {
      await interaction.deferReply({ ephemeral: true });
      await this.handleSnippetModalSubmit(interaction, snippetName);
      return;
    }

    this.logger.warn({ customId }, "Unknown toolbar modal submission");
  }

  private async handleSnippetModalSubmit(
    interaction: ModalMessageModalSubmitInteraction<"cached">,
    snippetName: string
  ): Promise<void> {
    const thread = await this.threadService.getThreadByChannelId(
      interaction.channelId
    );
    if (!thread || thread.isClosed) {
      await interaction.editReply(
        "This thread is closed -- your reply was not sent."
      );
      return;
    }

    const config = await this.configRepository.getConfig(thread.guildId);
    const content = interaction.fields.getTextInputValue(
      toolbarCustomID.modalSnippetInput
    );

    await this.messageService.relayStaffMessageToUser(
      thread.channelId,
      thread.userId,
      interaction.guild,
      {
        id: interaction.id,
        author: interaction.user,
        content,
        attachments: [],
        stickers: [],
        forwarded: false,
        createdTimestamp: interaction.createdTimestamp,
      },
      {
        anonymous: config.anonymousSnippets,
        plainText: false,
        snippet: true,
        snippetName,
      }
    );
    // No visible confirmation needed -- the fold above already shows the
    // reply in the channel, so this deferred ack just gets discarded.
    await interaction.deleteReply();
  }
}
