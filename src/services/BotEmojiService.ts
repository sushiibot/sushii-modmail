import { DiscordAPIError, RESTJSONErrorCodes, type Client } from "discord.js";
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
  ): Promise<BotEmoji> {
    let response;
    try {
      response = await client.application.emojis.create({
        attachment: file,
        name,
      });
    } catch (err) {
      if (err instanceof DiscordAPIError) {
        if (err.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType) {
          this.logger.error(
            { err: err.message, name, sha256 },
            `Failed to save emoji: ${name}`
          );

          throw new Error(
            `Failed to save emoji: ${name}, there's already an emoji with the same name. Please delete the old emoji first.`
          );
        }
      }

      // Rethrow for other errors
      throw err;
    }

    this.logger.info(
      {
        name: response.name,
        id: response.id,
      },
      `Uploaded emoji`
    );

    const emoji = await this.botEmojiRepository.saveEmoji(
      name,
      response.id,
      sha256
    );
    return emoji;
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
