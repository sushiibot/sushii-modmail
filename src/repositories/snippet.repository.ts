import { type DB } from "../database/db";
import { snippets } from "../database/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { Snippet } from "../models/snippet.model";

export class SnippetRepository {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async getSnippet(guildId: string, name: string): Promise<Snippet | null> {
    const result = await this.db
      .select()
      .from(snippets)
      .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)))
      .limit(1)
      .execute();

    if (result.length === 0) {
      return null;
    }

    return Snippet.fromDatabaseRow(result[0]);
  }

  async getAllSnippets(guildId: string): Promise<Snippet[]> {
    const result = await this.db
      .select()
      .from(snippets)
      .where(eq(snippets.guildId, guildId))
      .execute();

    return result.map(Snippet.fromDatabaseRow);
  }

  async createSnippet(
    guildId: string,
    name: string,
    content: string
  ): Promise<Snippet> {
    const inserted = await this.db
      .insert(snippets)
      .values({
        guildId,
        name,
        content,
      })
      .returning();

    return Snippet.fromDatabaseRow(inserted[0]);
  }

  async updateSnippet(
    guildId: string,
    name: string,
    content: string
  ): Promise<Snippet> {
    const updated = await this.db
      .update(snippets)
      .set({
        content,
      })
      .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)))
      .returning();

    return Snippet.fromDatabaseRow(updated[0]);
  }

  async deleteSnippet(guildId: string, name: string): Promise<boolean> {
    const deleted = await this.db
      .delete(snippets)
      .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)))
      .returning();

    return deleted.length > 0;
  }

  async getPinnedSnippets(guildId: string): Promise<Snippet[]> {
    const result = await this.db
      .select()
      .from(snippets)
      .where(
        and(eq(snippets.guildId, guildId), isNotNull(snippets.pinnedPosition))
      )
      .execute();

    return result
      .map(Snippet.fromDatabaseRow)
      .sort((a, b) => a.pinnedPosition! - b.pinnedPosition!);
  }

  /**
   * Assigns a snippet to a pin slot (1-4), clearing whichever other snippet
   * currently occupies that slot and clearing this snippet's own previous
   * slot, so a snippet only ever occupies one slot at a time.
   */
  async setPinnedPosition(
    guildId: string,
    name: string,
    position: number
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(snippets)
        .set({ pinnedPosition: null })
        .where(
          and(
            eq(snippets.guildId, guildId),
            eq(snippets.pinnedPosition, position)
          )
        );

      await tx
        .update(snippets)
        .set({ pinnedPosition: null })
        .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)));

      await tx
        .update(snippets)
        .set({ pinnedPosition: position })
        .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)));
    });
  }

  async clearPinnedPosition(guildId: string, name: string): Promise<void> {
    await this.db
      .update(snippets)
      .set({ pinnedPosition: null })
      .where(and(eq(snippets.guildId, guildId), eq(snippets.name, name)));
  }
}
