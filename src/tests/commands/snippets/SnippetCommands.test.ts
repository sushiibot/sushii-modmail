import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AddSnippetCommand } from "../../../commands/snippets/AddSnippetCommand";
import { EditSnippetCommand } from "../../../commands/snippets/EditSnippetCommand";

// args/rawArgs as produced by CommandRouter.breakDownMessage for
// "snippet <sub> <rest>": args is tokenized, rawArgs keeps whitespace.
function argsFor(rest: string): [string[], string] {
  return [rest.split(/\s+/).filter((s) => s.length > 0), rest];
}

describe("snippet add/edit content", () => {
  let snippetService: any;
  let msg: any;

  beforeEach(() => {
    snippetService = {
      snippetNameAllowed: mock(() => true),
      snippetExists: mock(() => Promise.resolve(false)),
      getSnippet: mock(() => Promise.resolve({ name: "foo" })),
      createSnippet: mock(() => Promise.resolve()),
      updateSnippet: mock(() => Promise.resolve()),
    };
    msg = {
      inGuild: () => true,
      guildId: "guild",
      client: { user: { id: "bot" } },
      reply: mock(() => Promise.resolve()),
    };
  });

  it("add keeps newlines and repeated spaces", async () => {
    const [args, rawArgs] = argsFor("Foo Line one\nLine two\n\n-  item");
    await new AddSnippetCommand(snippetService).handler(msg, args, rawArgs);

    expect(snippetService.createSnippet).toHaveBeenCalledWith(
      "guild",
      "foo",
      "Line one\nLine two\n\n-  item"
    );
  });

  it("add strips a newline directly after the name", async () => {
    const [args, rawArgs] = argsFor("foo\nbody");
    await new AddSnippetCommand(snippetService).handler(msg, args, rawArgs);

    expect(snippetService.createSnippet).toHaveBeenCalledWith(
      "guild",
      "foo",
      "body"
    );
  });

  it("edit keeps newlines", async () => {
    const [args, rawArgs] = argsFor("foo x\n\ny");
    await new EditSnippetCommand(snippetService).handler(msg, args, rawArgs);

    expect(snippetService.updateSnippet).toHaveBeenCalledWith(
      "guild",
      "foo",
      "x\n\ny"
    );
  });
});
