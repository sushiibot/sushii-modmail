import {
  AttachmentBuilder,
  Collection,
  ComponentType,
  GuildPremiumTier,
  MediaGalleryComponent,
  Message,
  type EmbedBuilder,
  type EmbedField,
} from "discord.js";
import { fetch } from "bun";
import {
  MediaGalleryAttachmentsID,
  MediaGalleryStickersID,
} from "./StaffThreadView";
import type { MessageSticker } from "models/message.model";
import { getLogger } from "utils/logger";

const logger = getLogger("views/util");

interface Attachment {
  name: string;
  url: string;
  // Present on discord.js Attachments, used to skip files the bot can't
  // re-upload before downloading them.
  size?: number;
}

const MiB = 1024 * 1024;

/**
 * Max size of a single file the bot can upload to a guild with the given
 * boost tier.
 */
export function uploadLimitBytes(premiumTier?: GuildPremiumTier): number {
  switch (premiumTier) {
    case GuildPremiumTier.Tier3:
      return 100 * MiB;
    case GuildPremiumTier.Tier2:
      return 50 * MiB;
    default:
      return 10 * MiB;
  }
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
export function createAttachmentListField(
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
 * Downloads attachments and converts them to AttachmentBuilder objects.
 * Files over maxBytes or that fail to download are skipped (and logged), so
 * the result may be shorter than the input -- one oversized file would
 * otherwise fail the whole upload.
 * @param attachments Collection of attachments to download
 * @param maxBytes Max size of a file the bot can re-upload
 * @returns Promise resolving to an array of AttachmentBuilder objects
 */
export async function downloadAttachments(
  attachments: Attachment[],
  maxBytes: number = uploadLimitBytes()
): Promise<AttachmentBuilder[]> {
  if (attachments.length === 0) {
    return [];
  }

  const fileDownloads = attachments.map(async (file, i) => {
    if (file.size !== undefined && file.size > maxBytes) {
      logger.warn(
        { name: file.name, size: file.size, maxBytes },
        "Skipping attachment over upload limit"
      );
      return null;
    }

    const res = await fetch(file.url);
    if (!res.ok) {
      // Don't re-upload an error page as the file contents
      logger.warn(
        { name: file.name, status: res.status },
        "Skipping attachment that failed to download"
      );
      return null;
    }

    const arrBuf = await res.arrayBuffer();

    const attachment = new AttachmentBuilder(Buffer.from(arrBuf));
    // Unique name for each attachment by adding index.
    // If the name is the same, it would show up as the same attachment when
    // referenced in embed / components.
    attachment.setName(`${i}-${file.name}`);

    return attachment;
  });

  // Download files in parallel
  const files = await Promise.all(fileDownloads);
  return files.filter((f): f is AttachmentBuilder => f !== null);
}

export function extractComponentImages(msg: Message): {
  attachmentUrls: string[];
  stickers: MessageSticker[];
} {
  const attachmentURLs = extractImageURLsFromComponents(msg);
  const stickerURLs = extractStickersFromComponents(msg);

  return {
    attachmentUrls: attachmentURLs,
    stickers: stickerURLs,
  };
}

// Both staffReplyComponents and userReplyComponents .setId() their media
// galleries (MediaGalleryAttachmentsID / MediaGalleryStickersID), and only
// messages sent by this code -- always with those IDs -- ever become a
// toolbar-overlay strip's bearer (a migrated thread's pre-existing bearer
// is always toolbarIsStandalone, i.e. toolbar-only, never a content
// message needing extraction). Plain ID lookup is sufficient; no
// positional fallback is needed for a case that can't occur.
export function extractImageURLsFromComponents(msg: Message): string[] {
  const containerComponent = msg.components.find(
    (c) => c.type === ComponentType.Container
  );
  if (!containerComponent) {
    throw new Error("No container component found");
  }

  const mediaGalleryComponent = containerComponent.components.find(
    (c): c is MediaGalleryComponent =>
      c.type === ComponentType.MediaGallery &&
      c.id === MediaGalleryAttachmentsID
  );

  if (!mediaGalleryComponent) {
    return [];
  }

  const imageUrls = mediaGalleryComponent.items.map((item) => {
    return item.media.url;
  });

  return imageUrls;
}

export function extractStickersFromComponents(msg: Message): MessageSticker[] {
  const containerComponent = msg.components.find(
    (c) => c.type === ComponentType.Container
  );
  if (!containerComponent) {
    throw new Error("No container component found");
  }

  const mediaGalleryComponents = containerComponent.components.find(
    (c): c is MediaGalleryComponent =>
      c.type === ComponentType.MediaGallery && c.id === MediaGalleryStickersID
  );
  if (!mediaGalleryComponents) {
    return [];
  }

  const stickers: MessageSticker[] = mediaGalleryComponents.items.map(
    (item) => {
      return {
        name: item.description || "Sticker",
        url: item.media.url,
      };
    }
  );

  return stickers;
}

export function quoteText(text: string): string {
  // Add a > to the start of each line
  return text
    .split("\n")
    .map((line) => {
      return `> ${line}`;
    })
    .join("\n");
}
