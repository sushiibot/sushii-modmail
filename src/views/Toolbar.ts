import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import type { Snippet } from "../models/snippet.model";
import { HexColor } from "./Color";

const toolbarCustomIDPrefix = "cmd.toolbar.";
const id = (name: string) => `${toolbarCustomIDPrefix}${name}`;

const toolbarModalPrefix = "modal.toolbar.";
const modalId = (name: string) => `${toolbarModalPrefix}${name}`;

export const PIN_SLOT_COUNT = 4;

export const toolbarCustomID = {
  reply: id("reply"),
  anonReply: id("anonReply"),
  close: id("close"),
  confirmClose: id("confirmClose"),
  cancelClose: id("cancelClose"),
  editPins: id("editPins"),
  snippetSelect: id("snippetSelect"),
  pinnedSnippet: (name: string) => id(`pin.${name}`),
  pinSlot: (slot: number) => id(`pinSlot.${slot}`),

  modalReply: modalId("reply"),
  modalAnonReply: modalId("anonReply"),
  modalReplyInput: modalId("reply.input"),
  modalSnippet: (name: string) => modalId(`snippet.${name}`),
  modalSnippetInput: modalId("snippet.input"),
};

// `cmd.toolbar.pin.<name>` -- extracts the snippet name back out
export function parsePinnedSnippetCustomId(customId: string): string | null {
  const prefix = id("pin.");
  return customId.startsWith(prefix) ? customId.slice(prefix.length) : null;
}

export function parseSnippetModalCustomId(customId: string): string | null {
  const prefix = modalId("snippet.");
  return customId.startsWith(prefix) ? customId.slice(prefix.length) : null;
}

export function isToolbarCustomId(customId: string): boolean {
  return (
    customId.startsWith(toolbarCustomIDPrefix) ||
    customId.startsWith(toolbarModalPrefix)
  );
}

export class ToolbarView {
  /**
   * Builds the persistent staff toolbar. On new thread activity the current
   * toolbar message is folded into the relayed reply (edited in place) and
   * a fresh one of these is posted below it -- see ToolbarService.foldReply.
   * Never deleted, so a reply referencing it never turns into a "message
   * was deleted" ghost.
   */
  static buildMessage(
    pinnedSnippets: Snippet[],
    unpinnedSnippets: Snippet[]
  ): MessageCreateOptions {
    // Distinct from every other message color in the thread (staff reply,
    // user message, edited, error) so the toolbar reads as a persistent
    // fixture at a glance, not another piece of conversation content.
    const container = new ContainerBuilder().setAccentColor(HexColor.Yellow);

    // Row 1: pinned snippet buttons + Edit Pins, filling Discord's 5-button
    // row cap exactly (4 pins + 1 management button). With zero pins, this
    // row is just the Edit Pins button, which doubles as the empty-state CTA.
    // Labeled -- unlike the reply/close rows, plain snippet-name buttons
    // aren't self-explanatory without it.
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Snippet shortcuts")
    );

    const pinRow = new ActionRowBuilder<ButtonBuilder>();
    for (const snippet of pinnedSnippets) {
      pinRow.addComponents(
        new ButtonBuilder()
          .setCustomId(toolbarCustomID.pinnedSnippet(snippet.name))
          .setLabel(snippet.name)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    pinRow.addComponents(
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.editPins)
        .setLabel("Edit Pins")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(pinRow);

    // Row 2: dropdown for everything else, opens a pre-filled reply modal.
    if (unpinnedSnippets.length > 0) {
      const snippetSelect = new StringSelectMenuBuilder()
        .setCustomId(toolbarCustomID.snippetSelect)
        .setPlaceholder("More snippets…")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          unpinnedSnippets
            .slice(0, 25)
            .map((snippet) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(snippet.name)
                .setValue(snippet.name)
            )
        );

      const snippetRow = new ActionRowBuilder<StringSelectMenuBuilder>();
      snippetRow.addComponents(snippetSelect);
      container.addActionRowComponents(snippetRow);
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );

    // Row 3: Anon Reply (primary, used ~2.4x more per usage data) + Reply.
    const replyRow = new ActionRowBuilder<ButtonBuilder>();
    replyRow.addComponents(
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.anonReply)
        .setLabel("Anon Reply")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.reply)
        .setLabel("Reply")
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(replyRow);

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
    );

    // Row 4: Close, isolated -- no reopen exists, so this is final.
    const closeRow = new ActionRowBuilder<ButtonBuilder>();
    closeRow.addComponents(
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.close)
        .setLabel("Close Thread")
        .setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(closeRow);

    const tipText = new TextDisplayBuilder().setContent(
      "-# Reply to this toolbar with `ar`/`reply`/`close` to skip the button — no prefix needed."
    );
    container.addTextDisplayComponents(tipText);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  /**
   * Ephemeral confirm/cancel prompt for Close -- a misclick among a row of
   * buttons is the real accident risk, unlike typing "close" as a reply or
   * text command, which already requires deliberate action. There's no
   * reopen, so this is the one toolbar action worth a confirm step.
   */
  static closeConfirmMessage(): {
    content: string;
    components: [ActionRowBuilder<ButtonBuilder>];
    flags: MessageFlags.Ephemeral;
  } {
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.confirmClose)
        .setLabel("Confirm Close")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(toolbarCustomID.cancelClose)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      content: "Are you sure you want to close this thread? This can't be undone.",
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    };
  }

  static replyModal(anonymous: boolean): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(anonymous ? toolbarCustomID.modalAnonReply : toolbarCustomID.modalReply)
      .setTitle(anonymous ? "Anonymous Reply" : "Reply");

    const input = new TextInputBuilder()
      .setCustomId(toolbarCustomID.modalReplyInput)
      .setLabel("Message")
      .setRequired(true)
      .setMaxLength(4000)
      .setStyle(TextInputStyle.Paragraph);

    const row = new ActionRowBuilder<TextInputBuilder>();
    row.addComponents(input);
    modal.addComponents(row);

    return modal;
  }

  /**
   * Modal pre-filled with a snippet's content -- doubles as the preview
   * (staff sees the exact wording) and the edit surface, in one step.
   */
  static snippetModal(snippet: Snippet): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(toolbarCustomID.modalSnippet(snippet.name))
      .setTitle(`Send Snippet: ${snippet.name}`.slice(0, 45));

    const input = new TextInputBuilder()
      .setCustomId(toolbarCustomID.modalSnippetInput)
      .setLabel("Message (editable)")
      .setRequired(true)
      .setMaxLength(4000)
      .setValue(snippet.content.slice(0, 4000))
      .setStyle(TextInputStyle.Paragraph);

    const row = new ActionRowBuilder<TextInputBuilder>();
    row.addComponents(input);
    modal.addComponents(row);

    return modal;
  }

  /**
   * Ephemeral pin-slot editor -- one select menu per slot (1-4), each
   * offering every snippet not currently pinned to a DIFFERENT slot, so
   * picking one in a slot removes it from the others automatically.
   */
  // Not annotated as MessageCreateOptions -- that type's `flags` is wider
  // than InteractionUpdateOptions accepts (no SuppressNotifications there),
  // and this return value is passed to both interaction.reply() and
  // interaction.update() at call sites. The explicit `flags` literal type
  // (rather than the general MessageFlags enum) is what keeps it assignable
  // to both.
  static pinsEditorMessage(allSnippets: Snippet[]): {
    components: [ContainerBuilder];
    flags: MessageFlags.IsComponentsV2;
    allowedMentions: { parse: [] };
  } {
    const container = new ContainerBuilder().setAccentColor(HexColor.Yellow);

    let content = "## Pinned Snippets";
    content += `\nPick up to ${PIN_SLOT_COUNT} snippets to show as quick-access buttons on the toolbar.`;
    content += "\n-# Only you can see this";

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content)
    );

    if (allSnippets.length === 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "-# No snippets exist yet in this server."
        )
      );

      return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
    }

    for (let slot = 1; slot <= PIN_SLOT_COUNT; slot++) {
      const currentlyPinnedName = allSnippets.find(
        (s) => s.pinnedPosition === slot
      )?.name;

      // Every snippet not pinned to a DIFFERENT slot -- includes this slot's
      // own current snippet (if any) so it stays selected/visible.
      const availableSnippets = allSnippets.filter(
        (s) => s.pinnedPosition === null || s.pinnedPosition === slot
      );

      if (availableSnippets.length === 0) {
        continue;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(toolbarCustomID.pinSlot(slot))
        .setPlaceholder(`Slot ${slot} — None`)
        .setMinValues(0)
        .setMaxValues(1)
        .addOptions(
          availableSnippets.slice(0, 25).map((snippet) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(snippet.name)
              .setValue(snippet.name)
              .setDefault(snippet.name === currentlyPinnedName)
          )
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>();
      row.addComponents(select);
      container.addActionRowComponents(row);
    }

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
}
