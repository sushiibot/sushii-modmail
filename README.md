# sushii-modmail

Discord ModMail bot utilizing forum channels for preserving previous ModMail
threads entirely on Discord.

- Search past threads directly on Discord.
- No need to deal with a custom web UI for chat logs.

## Features

Basics of what you expect in a Mod Mail bot. Feature set is fairly minimal to
those essential and more frequently used.

- **Built-in Organization** - ModMail threads are Forum channel threads.
- **Snippets** - Re-usable messages.

## Commands

This bot intentionally does not use slash commands for ease of use.

Responding to a thread
- `reply` - Reply to a thread.
- `areply` - Anonymously reply to a thread.
- `preply` - Plain text reply to a thread.
- `apreply` - Anonymous plain text reply to a thread.
- `edit` - Edit a previous thread message.
- `delete` - Delete a previous thread message.

Threads
- `contact` - Open a new thread with a user.

User information
- `logs` - Links to previous threads by the same user.

Snippets
- `snippet add [name] [content]` - Create a new snippet
- `snippet edit [name] [content]` - Modify an existing snippet
- `snippet delete [name]` - Delete a snippet

## Usage

You can run sushii-modmail with Docker.


## Development

sushii-modmail uses [Bun](https://bun.sh/) for development and runtime.

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start the bot
bun start
```

## Attributions

This project is inspired by [modmail-dev/Modmail](https://github.com/modmail-dev/Modmail).
