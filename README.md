# sushii-modmail

Discord ModMail bot utilizing forum channels to preserve previous ModMail
threads entirely on Discord. Search past threads directly on Discord without
needing a custom web UI.

## Features

Feature set is fairly minimal, focusing on essential and frequently used.

- **Built-in Organization** - ModMail threads are Forum channel threads.
- **Snippets** - Re-usable messages.
- **Anonymous Replies** - Keep staff members anonymous when replying.

## Commands

This bot intentionally does not use slash commands for ease of use.

Respond to a thread
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
- `snippet list` - List all available snippets
- `snippet delete [name]` - Delete a snippet

## Usage

You can run sushii-modmail with Docker.

Images are built and published to [Github container registry](https://github.com/sushiibot/sushii-modmail/pkgs/container/modmail)

```bash
docker run -d \
  --name sushii-modmail \
  -e TOKEN=your_discord_bot_token \
  -e OTHER_VARS=... \
  ghcr.io/sushiibot/modmail:latest
```

## Configuration

Configuration is set in environment variables. Here's an example .env file:

```env
# Logging
LOG_LEVEL=info

# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
PREFIX=!

# ModMail Settings
MAIL_GUILD_ID=your_guild_id
FORUM_CHANNEL_ID=your_forum_channel_id
ANONYMOUS_SNIPPETS=false
INITIAL_MESSAGE=Thank you for contacting the mod team! We'll get back to you as soon as possible.

# Sqlite database path
DATABASE_URI=./data/db.sqlite
```

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
