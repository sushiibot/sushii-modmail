import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { HexColor } from "./Color";

export class HelpCommandView {
  static help(): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(HexColor.Blue);

    let helpContent = `# Bot Commands`;

    helpContent += `\n## General Commands`;
    helpContent += `\n\`help\` - Show this help message`;
    helpContent += `\n\`settings\` - Show settings menu`;

    helpContent += `\n## Thread Commands`;
    helpContent += `\n\`contact\` - Open a new thread with a user`;
    helpContent += `\n\`reply\` - Reply to a thread`;
    helpContent += `\n\`areply\` - Anonymously reply to a thread`;
    helpContent += `\n\`preply\` - Plain text reply to a thread`;
    helpContent += `\n\`apreply\` - Anonymous plain text reply to a thread`;
    helpContent += `\n\`edit\` - Edit a previous thread message, reply to the message you want to edit`;
    helpContent += `\n\`delete\` - Delete a previous thread message, reply to the message you want to delete`;
    helpContent += `\n\`close\` - Close the current thread`;

    helpContent += `\n## User Information`;
    helpContent += `\n\`logs\` - Links to previous threads by the same user`;

    helpContent += `\n## Snippets`;
    helpContent += `\n\`snippet add [name] [content]\` - Create a new snippet`;
    helpContent += `\n\`snippet edit [name] [content]\` - Modify an existing snippet`;
    helpContent += `\n\`snippet [name]\` - Show a snippet's content`;
    helpContent += `\n\`snippet list\` - List all available snippets`;
    helpContent += `\n\`snippet delete [name]\` - Delete a snippet`;

    const text = new TextDisplayBuilder().setContent(helpContent);

    container.addTextDisplayComponents(text);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
}
