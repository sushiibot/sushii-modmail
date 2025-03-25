import { Message } from "discord.js";
import TextCommandHandler from "commands/CommandHandler";
import { SnippetService } from "services/SnippetService";
import { getLogger } from "utils/logger";
import { SnippetCommandView } from "views/SnippetCommandView";

export class AddSnippetCommand extends TextCommandHandler {
  commandName = "snippet";
  subCommandName = "add";

  aliases = ["new", "create"];

  private snippetService: SnippetService;
  private logger = getLogger(this.constructor.name);

  constructor(snippetService: SnippetService) {
    super();
    this.snippetService = snippetService;
  }

  async handler(msg: Message, args: string[]): Promise<void> {
    if (!msg.inGuild()) {
      await msg.reply(SnippetCommandView.notInGuild());
      return;
    }

    // Need at least 2 arguments: name and content
    if (args.length < 2) {
      await msg.reply(SnippetCommandView.addUsage());
      return;
    }

    const name = args[0].toLowerCase();
    const content = args.slice(1).join(" ");

    try {
      // Check if snippet already exists
      const existingSnippet = await this.snippetService.getSnippet(
        msg.guildId,
        name
      );

      if (existingSnippet) {
        await msg.reply(SnippetCommandView.snippetAlreadyExists(name));
        return;
      }

      // Create the new snippet
      await this.snippetService.createSnippet(msg.guildId, name, content);

      await msg.reply(SnippetCommandView.snippetAdded(name));
    } catch (error) {
      this.logger.error(`Error creating snippet: ${error}`);
      await msg.reply(SnippetCommandView.errorCreatingSnippet());
    }
  }
}
