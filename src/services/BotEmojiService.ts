import {
  DiscordAPIError,
  Emoji,
  RESTJSONErrorCodes,
  type Client,
} from "discord.js";
import type { BotEmoji, BotEmojiName } from "models/botEmoji.model";
import { getLogger } from "utils/logger";

interface BotEmojiRepository {
  saveEmoji(name: string, id: string, sha256: string): Promise<BotEmoji>;
}

export class DiscordBotEmojiService {
  private botEmojiRepository: BotEmojiRepository;

  private logger = getLogger(this.constructor.name);

  constructor(botEmojiRepository: BotEmojiRepository) {
    this.botEmojiRepository = botEmojiRepository;
  }

  async uploadEmoji(
    client: Client<true>,
    name: BotEmojiName,
    sha256: string,
    file: Buffer
  ): Promise<void> {
    let response;
    try {
      response = await client.application.emojis.create({
        attachment: file,
        name,
      });

      this.logger.info(
        {
          name: response.name,
          id: response.id,
        },
        `Uploaded emoji`
      );
    } catch (err) {
      if (!(err instanceof DiscordAPIError)) {
        // Unrelated error, treat as fatal
        throw err;
      }

      if (err.code !== RESTJSONErrorCodes.InvalidFormBodyOrContentType) {
        // Rethrow for other errors
        throw err;
      }

      // Only don't throw if the error is that the emoji name already exists
      this.logger.error(
        {
          err: err.message,
          emojiName: name,
          sha256,
        },
        `Failed to save emoji: ${name}, emoji name already exists. Skipping...`
      );

      // Can't save it because we need the emoji ID
      return;
    }

    await this.botEmojiRepository.saveEmoji(name, response.id, sha256);
  }

  async editEmoji(
    client: Client<true>,
    name: BotEmojiName,
    sha256: string,
    file: Buffer,
    emojiId: string
  ): Promise<BotEmoji> {
    this.logger.info({ emojiId, name, sha256 }, `Editing emoji: ${name}`);

    // Delete the old emoji first, can't edit content itself only name
    await client.application.emojis.delete(emojiId);

    this.logger.info({ emojiId }, `Deleted old emoji: ${name}`);

    // Upload the new emoji
    return this.uploadEmoji(client, name, sha256, file);
  }
}
