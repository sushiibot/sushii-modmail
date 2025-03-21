# sushii-modmail

Discord ModMail bot utilizing forum channels for preserving previous ModMail
threads entirely on Discord.

- Search past threads directly on Discord.
- No custom need to deal with a custom web UI for chat logs.

## Features

- **Built-in Organization** - ModMail threads are Forum channel threads.
- **Snippets** - Re-usable messages.
- **Default Anonymous** - 

## Commands

This bot intentionally does not use slash commands for ease of use.

Responding to a thread
- `reply` - Reply to a thread.
- `areply` - Anonymously reply to a thread.
- `preply` - Plain text reply to a thread.
- `apreply` - Anonymous plain text reply to a thread.
- `edit` - Edit a previous thread message.
- `delete` - Delete a previous thread message.

User information
- `history` - Links to previous threads by the same user.

## Development

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Attributions

This project is inspired by [modmail-dev/Modmail](https://github.com/modmail-dev/Modmail).
