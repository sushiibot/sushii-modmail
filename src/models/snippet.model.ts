import type { snippets } from "../database/schema";

// Snippet model (data structure)
export class Snippet {
  public guildId: string;
  public name: string;
  public content: string;
  public pinnedPosition: number | null;

  constructor(
    guildId: string,
    name: string,
    content: string,
    pinnedPosition: number | null = null
  ) {
    this.guildId = guildId;
    this.name = name;
    this.content = content;
    this.pinnedPosition = pinnedPosition;
  }

  static fromDatabaseRow(row: typeof snippets.$inferSelect): Snippet {
    return new Snippet(row.guildId, row.name, row.content, row.pinnedPosition);
  }

  public toString(): string {
    return this.content;
  }
}
