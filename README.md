# sushii-modmail

Discord ModMail bot utilizing forum channels to preserve previous ModMail
threads entirely on Discord. Search past threads directly on Discord without
needing a custom web UI.

## Features

Feature set is fairly minimal, focusing on essential and frequently used.

- **Built-in Organization** - ModMail threads are Forum channel threads.
- **Snippets** - Re-usable messages.
- **Anonymous Replies** - Keep staff members anonymous when replying.
- **Easy Setup** - No need for a web server or separate database.

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

You can run sushii-modmail with Docker and uses SQLite as the database so there
is no need to run a separate database server.

Images are built and published to [Github container registry](https://github.com/sushiibot/sushii-modmail/pkgs/container/modmail)

Images contain a [Litestream](https://litestream.io/) binary for automatic
replication of the SQLite database to a remote S3-compatible storage. This is
not enabled by default, but can be optionally configured.

Example Docker compose file:

```yml
services:
  modmail:
    name: sushii-modmail
    image: ghcr.io/sushiibot/modmail:latest
    restart: unless-stopped
    volumes:
      # Directory to store database
      - ./data:/app/data

      # If you want to override the default Litestream config, you can mount
      # your own, otherwise it will use the default config ./litestream.yml
      # and use environment variables below
      # https://litestream.io/reference/config/
      - ./litestream.yml:/etc/litestream.yml
    environment:
      - LOG_LEVEL=info
      - DISCORD_TOKEN=your_discord_bot_token
      - DISCORD_CLIENT_ID=your_discord_client_id
      - PREFIX=!
      - MAIL_GUILD_ID=your_guild_id
      - FORUM_CHANNEL_ID=your_forum_channel_id
      - ANONYMOUS_SNIPPETS=false
      - INITIAL_MESSAGE=Thank you for contacting the mod team! We'll get back to you as soon as possible.
      - DATABASE_URI=/app/data/db.sqlite

      # Litestream configuration
      - REPLICATE_DB=true # Optional, default is false
      # Restore if DB not found
      - RESTORE_DB=true # Optional, default is false

      - LITESTREAM_BUCKET=bucket-name
      - LITESTREAM_PATH=path/within/bucket
      - LITESTREAM_ENDPOINT=s3-endpoint
      - LITESTREAM_FORCE_PATH_STYLE=true # Optional, default is false, some S3 providers require this
```

Example litestream config:

```yml
access-key-id: your-backblaze-keyID
secret-access-key: your-backblaze-applicationKey

dbs:
    # Match the path in your docker-compose file
  - path: /app/data/db.sqlite
    replicas:
      - type: s3
        bucket: your-bucket-name
        path: db # change to whatever path you want
        endpoint: s3.us-west-000.backblazeb2.com # change this
        force-path-style: true
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
