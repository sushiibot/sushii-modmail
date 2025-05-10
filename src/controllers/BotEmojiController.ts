import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import type { ApplicationEmoji, Client } from "discord.js";
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

    const applicationEmojis = await client.application.emojis.fetch();
    const applicationNameToEmoji = new Map<string, ApplicationEmoji>();
    for (const emoji of applicationEmojis.values()) {
      if (!emoji.name) {
        continue;
      }

      applicationNameToEmoji.set(emoji.name, emoji);
    }

    for (const file of files) {
      if (!file.endsWith(".png")) {
        this.logger.warn(
          {
            file,
          },
          `Skipping non-PNG file`
        );

        continue;
      }

      // File name must be alphanumeric or underscores only
      if (!/^[a-zA-Z0-9_]+\.png$/.test(file)) {
        this.logger.warn(
          {
            file,
          },
          `Invalid emoji file name, skipping...`
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
          `Emoji is larger than 256 KB, skipping....`
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

      const existsInDB = await this.emojiRepository.getEmoji(
        validatedName.data
      );

      // If DB is kept, with a new Discord application, they will be in the DB
      // but not uploaded to the application yet.
      const emojiUploaded = applicationNameToEmoji.get(name);

      // Upload if: Not registered locally OR if the emoji is not uploaded yet.
      // If the opposite: emojis is uploaded but not registered, it will be
      // skipped on upload conflict failure
      if (!existsInDB || !emojiUploaded) {
        // Emoji doesn't exist in DATABASE, upload it
        this.logger.info(
          {
            emojiName: name,
            sha256,
          },
          `Emoji does not exist in database, uploading...`
        );

        await this.emojiService.uploadEmoji(
          client,
          validatedName.data,
          sha256,
          buffer
        );
        continue;
      }

      if (existsInDB.sha256 === sha256) {
        this.logger.trace(
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
          existingSha256: existsInDB.sha256,
          newSha256: sha256,
        },
        `Emoji ${name} has changed, updating...`
      );

      await this.emojiService.editEmoji(
        client,
        validatedName.data,
        sha256,
        buffer,
        existsInDB.id
      );
    }
  }

  async verifyRegisteredEmojis(): Promise<void> {
    // Check all emojis in enum exist in db. Enum just does type checking, but
    // we want to check they are actually stored in the database.
    const expectedEmojis = BotEmojiNameSchema.options;

    const registeredEmojis = await this.emojiRepository.getEmojis(
      BotEmojiNameSchema.options
    );

    // Check if all expected emojis are registered
    const missingEmojis = expectedEmojis.filter(
      (emoji) => !registeredEmojis.some((e) => e.name === emoji)
    );

    if (missingEmojis.length > 0) {
      this.logger.error(
        {
          missingEmojis,
        },
        "Emojis used but not registered in database, ensure emoji files exists"
      );
    } else {
      this.logger.info("All emojis are registered");
    }
  }
}
