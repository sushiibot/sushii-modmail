import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import type { Client } from "discord.js";
import type { BotEmojiName } from "../models/botEmoji.model";
import type { BotEmojiRepository } from "../repositories/botEmoji.repository";
import { DiscordBotEmojiService } from "../services/BotEmojiService";
import { getLogger } from "utils/logger";

export class BotEmojiController {
  private emojiService: DiscordBotEmojiService;
  private emojiRepository: BotEmojiRepository;
  private emojiDir: string;

  private logger = getLogger(this.constructor.name);

  constructor(
    emojiService: DiscordBotEmojiService,
    emojiRepository: BotEmojiRepository
  ) {
    this.emojiService = emojiService;
    this.emojiRepository = emojiRepository;
    this.emojiDir = path.resolve("./emojis/composites");
  }

  /**
   * Syncs emojis on startup: uploads new or changed emojis.
   */
  async syncEmojis(client: Client<true>): Promise<void> {
    const files = await fs.readdir(this.emojiDir);

    for (const file of files) {
      if (!file.endsWith(".png")) {
        continue;
      }

      const name = path.basename(file, ".png") as BotEmojiName;

      const filePath = path.join(this.emojiDir, file);
      const buffer = await fs.readFile(filePath);

      const sha256 = createHash("sha256").update(buffer).digest("hex");

      const existing = await this.emojiRepository.getEmoji(name);
      if (!existing) {
        await this.emojiService.uploadEmoji(client, name, sha256, buffer);
        return;
      }

      if (existing.sha256 === sha256) {
        // Emoji is already up to date
        return;
      }

      // Emoji has changed, update it
      this.logger.info(
        {
          existingSha256: existing.sha256,
          newSha256: sha256,
        },
        `Emoji ${name} has changed, updating...`
      );

      await this.emojiService.editEmoji(
        client,
        name,
        sha256,
        buffer,
        existing.id
      );
    }
  }
}
