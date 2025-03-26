import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import { Snippet } from "../models/snippet.model";
import { Color } from "./Color";

export class SnippetCommandView {
  static notInGuild(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("This command can only be used in a server.")
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static addUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet add <name> <content>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static editUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet edit <name> <new content>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static deleteUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet delete <name>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetAlreadyExists(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        `A snippet with the name \`${name}\` already exists. Use the update command to modify it.`
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetDoesNotExist(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        `No snippet with the name \`${name}\` exists. Use the add command to create a new snippet.`
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetAdded(name: string, content: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully added snippet \`${name}\`.`)
      .addFields({
        name: "Content",
        value: content,
      })
      .setColor(Color.Blue);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetUpdated(name: string, content: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully updated snippet \`${name}\`.`)
      .addFields({
        name: "Content",
        value: content,
      })
      .setColor(Color.Blue);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetDeleted(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully deleted snippet \`${name}\`.`)
      .setColor(Color.Blue);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetDeleteFailed(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Failed to delete snippet \`${name}\`.`)
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static errorCreatingSnippet(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        "Failed to create snippet. Please check the logs for details."
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static errorUpdatingSnippet(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        "Failed to update snippet. Please check the logs for details."
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static errorDeletingSnippet(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        "Failed to delete snippet. Please check the logs for details."
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static errorListingSnippets(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(
        "Failed to retrieve snippets. Please check the logs for details."
      )
      .setColor(Color.Pink);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static noSnippets(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("No snippets have been created for this server yet.")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
      allowedMentions: {},
    };
  }

  static snippetList(snippets: Snippet[]): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setTitle("Available Snippets")
      .setColor(Color.Purple)
      .setDescription(
        snippets
          .map((snippet) => `\`${snippet.name}\` - ${snippet.content}`)
          .join(", ")
      )
      .setFooter({ text: `Total snippets: ${snippets.length}` });

    return { embeds: [embed], allowedMentions: {} };
  }
}
