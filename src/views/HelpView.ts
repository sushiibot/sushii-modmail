import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { HexColor } from "./Color";
import type { BotConfig } from "models/botConfig.model";

export class HelpCommandView {
  static help(config: BotConfig): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    const helpContent = [
      `# Bot Commands`,

      `\n## General Commands`,
      `\n\`help\` - Show this help message`,
      `\n\`settings\` (\`setup\`) - Show settings menu`,
      `\n\`say [channel]\` - Compose and send a custom embed to a channel (current channel if omitted)`,

      `\n## Thread Commands`,
      `\n\`contact\` (\`open\`) \`<user>\` - Open a new thread with a user`,
      `\n\`reply\` (\`r\`) - Reply to a thread`,
      `\n\`areply\` (\`ar\`) - Anonymously reply to a thread`,
      `\n\`preply\` (\`pr\`) - Reply as a regular message (no box)`,
      `\n\`apreply\` (\`apr\`, \`par\`) - Anonymous reply as a regular message (no box)`,
      `\n\`edit\` (\`e\`) - Edit a previous thread message, reply to the message you want to edit`,
      `\n\`delete\` (\`d\`) - Delete a previous thread message, reply to the message you want to delete`,
      `\n\`close\` (\`c\`) \`[optional message]\` - Close the current thread, optionally providing staff-only reason for closure`,

      `\n## Toolbar`,
      `\nEvery open thread has a toolbar on its latest message: snippet shortcuts, Reply / Anon Reply, and Close.`,
      `\nReply to the toolbar message to run a command without a prefix, e.g. \`ar thanks!\` or \`close resolved\`.`,

      `\n## User Information`,
      `\n\`logs [user ID]\` - Links to previous threads by the same user (no argument needed inside a thread; user ID required elsewhere)`,

      `\n## Snippets`,
      `\n\`<name>\` - In a modmail thread, send a snippet to the user (prefix or @mention, e.g. \`@bot greeting\`); add \`-p\` to send it as a regular message (no box)`,
      `\n\`snippet add\` (\`new\`, \`create\`) \`[name] [content]\` - Create a new snippet`,
      `\n\`snippet edit\` (\`update\`, \`modify\`) \`[name] [content]\` - Modify an existing snippet`,
      `\n\`snippet [name]\` - Show a snippet's content`,
      `\n\`snippet list\` (\`all\`, \`show\`) - List all available snippets`,
      `\n\`snippet delete\` (\`remove\`) \`[name]\` - Delete a snippet`,

      `\n## Guides`,
      `\n- [Setup guide](https://github.com/sushiibot/sushii-modmail/blob/main/docs/SETUP_GUIDE.md)`,
      `\n- [Staff guide](https://github.com/sushiibot/sushii-modmail/blob/main/docs/USER_GUIDE.md)`,
    ];

    if (config.gitHash || config.buildDate) {
      const hash = config.gitHash ? config.gitHash.slice(0, 7) : "unknown";
      const date = config.buildDate
        ? `<t:${Math.floor(config.buildDate.getTime() / 1000)}:f>`
        : "unknown";
      helpContent.push(`\n\n-# Bot Version: \`${hash}\` - ${date}`);
    }

    const text = new TextDisplayBuilder().setContent(helpContent.join(""));

    container.addTextDisplayComponents(text);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
}
