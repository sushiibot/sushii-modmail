# sushii-modmail

Discord ModMail bot utilizing forum channels to preserve previous ModMail
threads entirely on Discord. Search past threads directly on Discord without
needing a custom web UI.

<p align="center">
  <img
    src="https://github.com/sushiibot/sushii-modmail/blob/main/images/01_forum_list.png?raw=true"
    alt="Thread List"
    width="500"
    style="vertical-align: top;"
  />
  <img
    src="https://github.com/sushiibot/sushii-modmail/blob/main/images/02_thread.png?raw=true"
    alt="Modmail Thread"
    width="500"
    style="vertical-align: top;"
  />
</p>

## Features

Focused on simplicity and user experience, sushii-modmail provides:

- **Built-in Organization and Archive** - ModMail threads are Forum channel
  threads. Forum tags are used so you can only show the threads that are
  currently open. No more worrying about losing thread history if the bot goes
  offline or if you need to change to a different bot.
- **Configurable Message** - Initial message sent to the user when they open a
  thread.
- **Configurable Notifications** - Ping roles when a new thread is opened,
  optionally a silent ping.
- **Snippets** - Re-usable messages for common responses. Snippets can be
  configured to be anonymous or not.
- **Anonymous Replies** - Keep staff members anonymous when replying.
- **Easy Setup** - No need for a web server or separate database.

## Commands

General
- `settings` - Setup, view, and change bot settings.

Thread
- `contact` - Open a new thread with a user (if staff wants to contact user)
- `reply` - Reply to a thread.
- `areply` - Anonymously reply to a thread.
- `preply` - Plain text reply to a thread.
- `apreply` - Anonymous plain text reply to a thread.
- `edit` - Edit a previous thread message, reply to the message you want to edit.
- `delete` - Delete a previous thread message, reply to the message you want to
  delete.
- `close [optional reason]` - Close the current thread, optionally with a
  reason. The reason will **not** be sent to the user, but will be logged in the
  thread.

User information
- `logs` - Links to previous threads by the same user.

Snippets
- `snippet add [name] [content]` - Create a new snippet
- `snippet edit [name] [content]` - Modify an existing snippet
- `snippet [name]` - Show a snippet's content
- `snippet list` - List all available snippets
- `snippet delete [name]` - Delete a snippet

## Notes on design choices

- This bot intentionally does not use slash commands for ease of use.
- Closing threads does **not** send anything to the user. Since the user only
  sees a DM with the bot, there isn't anything being "closed" or changed for
  them. Closing threads only changes things on the staff side, so it doesn't
  make sense to show the user anything.

## Deployment

The recommended way to run sushii-modmail is via Docker. It uses an embedded
SQLite database, so no separate database service is required.

Images are built and published to [Github container registry](https://github.com/sushiibot/sushii-modmail/pkgs/container/modmail). 

> [!NOTE]
> sushii-modmail follows a rolling-release model. Each commit is built and
> tagged with it's short SHA hash. There are no fixed (e.g. `v1.0.0`) releases.
> You can use the `latest` tag to always get the latest version, or specify a
> specific commit hash to pin to a specific version.

Images contain a [Litestream](https://litestream.io/) binary for automatic
replication of the SQLite database to a remote S3-compatible storage. This is
not enabled by default, but can be optionally enabled configured. A
[default Litestream configuration](./litestream.yml) file is included in the
image, but you can override it by mounting your own configuration file at
`/etc/litestream.yml` in the container.

Example Docker compose file with all the environment variables

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
      #  Base settings
      - LOG_LEVEL=info
      - DISCORD_TOKEN=your_discord_bot_token
      - DISCORD_CLIENT_ID=your_discord_client_id
      - DATABASE_URI=/app/data/db.sqlite

      # Required Settings
      - MAIL_GUILD_ID=your_guild_id

      # Litestream configuration
      - REPLICATE_DB=true # Optional, default is false
      # Restore if DB not found
      - RESTORE_DB=true # Optional, default is false

      - LITESTREAM_ACCESS_KEY_ID=s3-access-key-id
      - LITESTREAM_SECRET_ACCESS_KEY=s3-secret-access-key
      - LITESTREAM_BUCKET=bucket-name
      - LITESTREAM_PATH=path/within/bucket
      - LITESTREAM_ENDPOINT=s3-endpoint
      - LITESTREAM_FORCE_PATH_STYLE=true # Optional, default is false, some S3 providers require this
```

### Running multiple bots in one process

A single sushii-modmail process can run multiple independent bot instances
(distinct Discord tokens/applications/guilds), sharing one database
connection. This is entirely optional -- the single-bot env vars above
(`DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID`) remain fully
supported and are used automatically whenever no numbered `BOT_1_*` vars
are set.

To run more than one bot, use numbered env vars instead, one block per
bot, starting at `1` with no gaps:

```yml
environment:
  - LOG_LEVEL=info
  - DATABASE_URI=/app/data/db.sqlite

  - BOT_1_NAME=lisa
  - BOT_1_DISCORD_TOKEN=bot-1-token
  - BOT_1_DISCORD_CLIENT_ID=bot-1-client-id
  - BOT_1_MAIL_GUILD_ID=bot-1-guild-id

  - BOT_2_NAME=bp
  - BOT_2_DISCORD_TOKEN=bot-2-token
  - BOT_2_DISCORD_CLIENT_ID=bot-2-client-id
  - BOT_2_MAIL_GUILD_ID=bot-2-guild-id
```

If `BOT_1_NAME` is present, the numbered format takes precedence and the
legacy single-bot vars are ignored. Each bot must have a distinct `NAME`,
`DISCORD_CLIENT_ID`, and `MAIL_GUILD_ID` -- the process refuses to start
if any of those collide across entries.

One bot's startup failure doesn't prevent the others from starting, and an
unhandled error in one bot's event handler doesn't crash the others; the
healthcheck server reports every bot's status on the same port
(`/live` for process liveness, `/ready`/`/health` for per-bot Discord
connection status).

#### Migrating existing per-bot databases into a shared one

If you're consolidating previously-separate single-bot deployments into
one multi-bot process, use `scripts/merge-bot-dbs.ts` to merge their
SQLite files into one, then `scripts/verify-merged-db.ts` to check the
result before switching `DATABASE_URI` over:

```bash
bun run scripts/merge-bot-dbs.ts \
  --source /path/to/lisa.sqlite:lisa-discord-client-id \
  --source /path/to/bp.sqlite:bp-discord-client-id \
  --output /path/to/merged.sqlite

bun run scripts/verify-merged-db.ts \
  --source /path/to/lisa.sqlite:lisa-discord-client-id \
  --source /path/to/bp.sqlite:bp-discord-client-id \
  --merged /path/to/merged.sqlite
```

Both scripts only ever read from the source files (safe to run against
copies of live databases), and `merge-bot-dbs.ts` aborts with no output
file written if it finds the same guild id in more than one source --
that indicates two bots already serving the same guild, which isn't
supported. `verify-merged-db.ts` exits non-zero with a JSON summary if
anything doesn't match (row counts, ownership backfill).

## Bot Setup and Guide

Once the bot is running, check out the:
- [Setup Guide](./docs/SETUP_GUIDE.md) for initial setup and configuration.
- [User Guide](./docs/USER_GUIDE.md) for how to use the bot or to share with your staff members.

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
