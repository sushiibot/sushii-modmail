import { describe, expect, it } from "bun:test";
import { HelpCommandView } from "../../views/HelpView";

function helpText(): string {
  const message = HelpCommandView.help({} as any);
  const container = (message.components![0] as any).toJSON();
  return container.components.map((c: any) => c.content).join("");
}

describe("HelpCommandView.help", () => {
  it("lists command aliases inline", () => {
    const text = helpText();

    for (const alias of ["`r`", "`ar`", "`pr`", "`apr`", "`par`", "`c`", "`e`", "`d`", "`open`", "`setup`"]) {
      expect(text).toContain(alias);
    }
  });

  it("documents the toolbar, sending snippets by name, -p, and logs by user ID", () => {
    const text = helpText();

    expect(text).toContain("## Toolbar");
    expect(text).toContain("Reply to the toolbar message");
    expect(text).toContain("`<name>`");
    expect(text).toContain("`-p`");
    expect(text).toContain("`logs [user ID]`");
  });

  it("stays within a single TextDisplay's 4000-char budget", () => {
    expect(helpText().length).toBeLessThan(4000);
  });
});
