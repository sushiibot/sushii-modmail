import { describe, expect, it } from "bun:test";
import {
  isToolbarCustomId,
  parsePinnedSnippetCustomId,
  parseSnippetModalCustomId,
  toolbarCustomID,
  ToolbarView,
} from "../../views/Toolbar";
import type { Snippet } from "../../models/snippet.model";

function mockSnippet(name: string, pinnedPosition: number | null = null): Snippet {
  return { guildId: "guild-1", name, content: `content for ${name}`, pinnedPosition } as Snippet;
}

// Buttons/components live inside a single ContainerBuilder -- flatten its
// JSON so assertions can just look for text without walking nested arrays.
function flatten(message: ReturnType<typeof ToolbarView.buildMessage>): string {
  return JSON.stringify(message.components!.map((c: any) => c.toJSON()));
}

describe("ToolbarView.buildMessage", () => {
  it("shows only Edit Pins when there are no pinned snippets (empty-state CTA)", () => {
    const message = ToolbarView.buildMessage([], []);
    const json = flatten(message);

    expect(json).toContain("Edit Pins");
    expect(json).not.toContain(toolbarCustomID.pinnedSnippet("anything"));
  });

  it("includes a button per pinned snippet plus Edit Pins in the same row", () => {
    const pinned = [mockSnippet("faq", 1), mockSnippet("rules", 2)];
    const message = ToolbarView.buildMessage(pinned, []);
    const json = flatten(message);

    expect(json).toContain("faq");
    expect(json).toContain("rules");
    expect(json).toContain("Edit Pins");
    expect(json).toContain(toolbarCustomID.pinnedSnippet("faq"));
    expect(json).toContain(toolbarCustomID.pinnedSnippet("rules"));
  });

  it("omits the snippet dropdown row entirely when there are no unpinned snippets", () => {
    const message = ToolbarView.buildMessage([mockSnippet("faq", 1)], []);
    const json = flatten(message);

    expect(json).not.toContain(toolbarCustomID.snippetSelect);
  });

  it("includes the snippet dropdown with unpinned snippets as options", () => {
    const unpinned = [mockSnippet("scam-warning"), mockSnippet("wait-times")];
    const message = ToolbarView.buildMessage([], unpinned);
    const json = flatten(message);

    expect(json).toContain(toolbarCustomID.snippetSelect);
    expect(json).toContain("scam-warning");
    expect(json).toContain("wait-times");
  });

  it("always includes Reply, Anon Reply, and Close buttons", () => {
    const message = ToolbarView.buildMessage([], []);
    const json = flatten(message);

    expect(json).toContain(toolbarCustomID.reply);
    expect(json).toContain(toolbarCustomID.anonReply);
    expect(json).toContain(toolbarCustomID.close);
  });

  it("includes the reply-to-toolbar tip text", () => {
    const message = ToolbarView.buildMessage([], []);
    const json = flatten(message);

    expect(json).toContain("no prefix needed");
  });
});

describe("ToolbarView.pinsEditorMessage", () => {
  it("shows a placeholder message when no snippets exist yet", () => {
    const message = ToolbarView.pinsEditorMessage([]);
    const json = JSON.stringify(message.components.map((c: any) => c.toJSON()));

    expect(json).toContain("No snippets exist yet");
  });

  it("marks the currently-pinned snippet as the default option in its slot", () => {
    const snippets = [mockSnippet("faq", 2), mockSnippet("rules")];
    const message = ToolbarView.pinsEditorMessage(snippets);
    const json = JSON.stringify(message.components.map((c: any) => c.toJSON()));

    // Slot 2's select should have "faq" marked default; slot 1 should not.
    const parsed = message.components.map((c: any) => c.toJSON());
    const container = parsed[0];
    const actionRows = container.components.filter(
      (c: any) => c.type === 1 // ActionRow
    );

    const slot2Row = actionRows.find((row: any) =>
      row.components[0].custom_id === toolbarCustomID.pinSlot(2)
    );
    const faqOption = slot2Row.components[0].options.find(
      (o: any) => o.value === "faq"
    );
    expect(faqOption.default).toBe(true);
  });

  it("excludes a snippet pinned to a different slot from other slots' options", () => {
    const snippets = [mockSnippet("faq", 1), mockSnippet("rules")];
    const message = ToolbarView.pinsEditorMessage(snippets);
    const parsed = message.components.map((c: any) => c.toJSON());
    const container = parsed[0];
    const actionRows = container.components.filter((c: any) => c.type === 1);

    const slot2Row = actionRows.find((row: any) =>
      row.components[0].custom_id === toolbarCustomID.pinSlot(2)
    );
    const values = slot2Row.components[0].options.map((o: any) => o.value);

    expect(values).not.toContain("faq");
    expect(values).toContain("rules");
  });
});

describe("customId helpers", () => {
  it("round-trips a pinned snippet name through its custom ID", () => {
    const customId = toolbarCustomID.pinnedSnippet("my-snippet");
    expect(parsePinnedSnippetCustomId(customId)).toBe("my-snippet");
  });

  it("returns null for a pinned-snippet parse on an unrelated customId", () => {
    expect(parsePinnedSnippetCustomId(toolbarCustomID.close)).toBeNull();
  });

  it("round-trips a snippet name through its modal custom ID", () => {
    const customId = toolbarCustomID.modalSnippet("my-snippet");
    expect(parseSnippetModalCustomId(customId)).toBe("my-snippet");
  });

  it("identifies toolbar button/select customIds", () => {
    expect(isToolbarCustomId(toolbarCustomID.close)).toBe(true);
    expect(isToolbarCustomId(toolbarCustomID.snippetSelect)).toBe(true);
  });

  it("identifies toolbar modal customIds", () => {
    expect(isToolbarCustomId(toolbarCustomID.modalReply)).toBe(true);
    expect(isToolbarCustomId(toolbarCustomID.modalSnippet("x"))).toBe(true);
  });

  it("rejects unrelated customIds", () => {
    expect(isToolbarCustomId("cmd.settings.prefix")).toBe(false);
    expect(isToolbarCustomId("modal.settings.prefix")).toBe(false);
  });
});
