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
    };
  }

  static addUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet add <name> <content>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static editUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet edit <name> <new content>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static deleteUsage(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("Usage: `!snippet delete <name>`")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
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
    };
  }

  static snippetAdded(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully added snippet \`${name}\`.`)
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static snippetUpdated(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully updated snippet \`${name}\`.`)
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static snippetDeleted(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Successfully deleted snippet \`${name}\`.`)
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static snippetDeleteFailed(name: string): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription(`Failed to delete snippet \`${name}\`.`)
      .setColor(Color.Pink);

    return {
      embeds: [embed],
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
    };
  }

  static noSnippets(): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setDescription("No snippets have been created for this server yet.")
      .setColor(Color.Gray);

    return {
      embeds: [embed],
    };
  }

  static snippetList(snippets: Snippet[]): MessageCreateOptions {
    const embed = new EmbedBuilder()
      .setTitle("Available Snippets")
      .setColor(Color.Lavender)
      .setDescription(
        snippets.map((snippet) => `\`${snippet.name}\``).join(", ")
      )
      .setFooter({ text: `Total snippets: ${snippets.length}` });

    return { embeds: [embed] };
  }
}
