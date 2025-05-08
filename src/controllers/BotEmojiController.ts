import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import type { Client } from "discord.js";
import {
  BotEmojiNameSchema,
  type BotEmojiName,
} from "../models/botEmoji.model";
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

    this.logger.info(
      {
        emojis: files.length,
      },
      `Found ${files.length} emojis to sync`
    );

    for (const file of files) {
      if (!file.endsWith(".png")) {
        this.logger.warn(
          {
            file,
          },
          `Skipping non-PNG file: ${file}`
        );

        continue;
      }

      // File name must be alphanumeric or underscores only
      if (!/^[a-zA-Z0-9_]+\.png$/.test(file)) {
        this.logger.warn(
          {
            file,
          },
          `Skipping invalid file name: ${file}`
        );

        continue;
      }

      // Check the file is under 256 KB
      const stats = await fs.stat(path.join(this.emojiDir, file));
      if (stats.size > 256 * 1024) {
        this.logger.warn(
          {
            file,
            size: stats.size,
          },
          `Skipping emoji larger than 256 KB: ${file}`
        );

        continue;
      }

      const name = path.basename(file, ".png");

      const validatedName = BotEmojiNameSchema.safeParse(name);

      if (!validatedName.success) {
        throw new Error(
          `Invalid emoji name: '${name}', not included in emoji name list: ${validatedName.error}`
        );
      }

      const filePath = path.join(this.emojiDir, file);
      const buffer = await fs.readFile(filePath);

      const sha256 = createHash("sha256").update(buffer).digest("hex");

      const existing = await this.emojiRepository.getEmoji(validatedName.data);
      if (!existing) {
        // Emoji doesn't exist, upload it
        this.logger.info(
          {
            name,
            sha256,
          },
          `Emoji ${name} does not exist, uploading...`
        );

        await this.emojiService.uploadEmoji(
          client,
          validatedName.data,
          sha256,
          buffer
        );
        continue;
      }

      if (existing.sha256 === sha256) {
        this.logger.debug(
          {
            name,
          },
          `Emoji ${name} already exists, skipping...`
        );

        // Emoji is already up to date
        continue;
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
        validatedName.data,
        sha256,
        buffer,
        existing.id
      );
    }
  }
}
