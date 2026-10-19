import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Collection, EmbedBuilder, GuildPremiumTier } from "discord.js";
import {
  createAttachmentListField,
  downloadAttachments,
  quoteText,
  uploadLimitBytes,
} from "../../views/util";

// Helper attachment/sticker interfaces
interface Attachment {
  id: string;
  name: string;
  url: string;
}

interface Sticker {
  id: string;
  name: string;
  url: string;
}

describe("views/util", () => {
  describe("createAttachmentListField", () => {
    it("returns null for empty collection", () => {
      const attachments = new Collection<string, Attachment>();
      expect(createAttachmentListField(attachments)).toBeNull();
    });

    it("formats attachment links", () => {
      const attachments = new Collection<string, Attachment>([
        ["1", { id: "1", name: "a.txt", url: "https://a" }],
        ["2", { id: "2", name: "b.txt", url: "https://b" }],
      ]);

      const field = createAttachmentListField(attachments)!;
      expect(field.name).toBe("Original Attachments");
      expect(field.value).toContain("[a.txt](https://a)");
      expect(field.value).toContain("[b.txt](https://b)");
    });
  });

  describe("quoteText", () => {
    it("prefixes each line with >", () => {
      const input = "line1\nline2";
      expect(quoteText(input)).toBe("> line1\n> line2");
    });
  });
});

describe("downloadAttachments", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === "/ok"
          ? new Response("file-data")
          : new Response("Not Found", { status: 404 });
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("downloads files and prefixes names with their index", async () => {
    const files = await downloadAttachments([
      { name: "a.txt", url: `${base}/ok`, size: 9 },
    ]);

    expect(files.map((f) => f.name)).toEqual(["0-a.txt"]);
  });

  it("skips files that fail to download", async () => {
    const files = await downloadAttachments([
      { name: "missing.txt", url: `${base}/missing` },
      { name: "b.txt", url: `${base}/ok` },
    ]);

    expect(files.map((f) => f.name)).toEqual(["1-b.txt"]);
  });

  it("skips files over the upload limit without fetching", async () => {
    const files = await downloadAttachments(
      [{ name: "big.zip", url: "http://invalid.invalid/big", size: 11 }],
      10
    );

    expect(files).toEqual([]);
  });

  it("raises the upload limit with boost tier", () => {
    expect(uploadLimitBytes()).toBe(10 * 1024 * 1024);
    expect(uploadLimitBytes(GuildPremiumTier.Tier2)).toBe(50 * 1024 * 1024);
    expect(uploadLimitBytes(GuildPremiumTier.Tier3)).toBe(100 * 1024 * 1024);
  });
});
