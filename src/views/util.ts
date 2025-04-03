import { AttachmentBuilder, Collection, type EmbedField } from "discord.js";
import { fetch } from "bun";

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

/**
 * Creates an embed field for attachments
 * @param attachments Collection of attachments
 * @returns EmbedField for attachments or null if no attachments
 */
export function createAttachmentField(
  attachments: Collection<string, Attachment>
): EmbedField | null {
  if (attachments.size === 0) {
    return null;
  }

  const attachmentLinks = Array.from(attachments.values())
    .map((attachment) => `[${attachment.name}](${attachment.url})`)
    .join("\n");

  const name = attachments.size > 1 ? "Attachments" : "Attachment";

  return {
    name: `Original ${name}`,
    value: attachmentLinks,
    inline: false,
  };
}

/**
 * Creates an embed field for stickers
 * @param stickers Collection of stickers
 * @returns EmbedField for stickers or null if no stickers
 */
export function createStickerField(
  stickers: Collection<string, Sticker>
): EmbedField | null {
  if (stickers.size === 0) {
    return null;
  }

  const stickerLinks = Array.from(stickers.values())
    .map((sticker) => `[${sticker.name}](${sticker.url})`)
    .join("\n");

  const name = stickers.size > 1 ? "Stickers" : "Sticker";

  return {
    name,
    value: stickerLinks,
    inline: false,
  };
}

/**
 * Downloads attachments and converts them to AttachmentBuilder objects
 * @param attachments Collection of attachments to download
 * @returns Promise resolving to an array of AttachmentBuilder objects
 */
export async function downloadAttachments(
  attachments: Collection<string, Attachment>
): Promise<AttachmentBuilder[]> {
  if (attachments.size === 0) {
    return [];
  }

  const fileDownloads = Array.from(attachments.values()).map(async (file) => {
    const res = await fetch(file.url);
    const arrBuf = await res.arrayBuffer();
    const attachment = new AttachmentBuilder(Buffer.from(arrBuf)).setName(
      file.name
    );

    return attachment;
  });

  // Download files in parallel
  return Promise.all(fileDownloads);
}
