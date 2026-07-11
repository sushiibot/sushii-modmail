## Why

Each modmail bot instance (lisa, bp, twice) today runs as its own Docker
container/process with its own env vars and SQLite file, so adding a new
bot means a new Ansible service, new secrets, and another container to
monitor. Running multiple bots inside one process cuts that ops overhead —
adding a bot becomes a roster entry instead of a new service.

## What Changes

- Add a `BotRegistry` abstraction and an `EnvBotRegistry` implementation
  that reads a numbered-prefix roster from env vars (`BOT_1_NAME`,
  `BOT_1_DISCORD_TOKEN`, `BOT_1_DISCORD_CLIENT_ID`, `BOT_1_MAIL_GUILD_ID`,
  `BOT_2_...`, etc.), scanning until it hits a gap. **Not breaking**:
  `EnvBotRegistry` falls back to synthesizing a single-entry roster from
  the legacy `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID` vars when
  no `BOT_1_*` vars are present, so any deployment that doesn't opt into
  the numbered format keeps working unchanged. `BotRegistry` stays an
  interface so a future DB-backed registry can replace `EnvBotRegistry`
  without touching `main()`.
- The shared-DB scoping approach (guild-keyed tables) requires each bot to
  serve a distinct Discord guild. `BotRegistry` validates the roster at
  load time and refuses to start if two entries share a `mailGuildId`,
  since two bots on the same guild would silently collide on one
  `runtimeConfig`/`snippets` row otherwise.
- Rewrite `main()` to loop over the roster, creating one `discord.js`
  `Client` + command router + event handlers per bot, all sharing one
  process and one database connection.
- Add per-bot startup fault isolation (`Promise.allSettled`) and
  process-level `unhandledRejection`/`uncaughtException` handlers that
  log-and-continue, so one bot's failure doesn't take down the others.
- **BREAKING**: move from one SQLite file per bot to a single shared SQLite
  file across all bots, relying on existing guild-scoped tables
  (`threads`, `snippets`, `runtimeConfig`).
- Add an `applicationId` column to the `botEmojis` table and change its
  unique constraint from a global `name` uniqueness to a composite
  `(applicationId, name)`, so bots sharing the DB can each register an
  emoji with the same name without a constraint violation. Update
  `BotEmojiRepository`'s lookups/upserts to filter and target by
  `applicationId` as well as `name`, so emoji reads/writes can't cross
  bot boundaries.
- Add a one-off, rerunnable, read-only-on-sources script to merge the
  existing separate per-bot SQLite files into the new shared DB,
  backfilling `applicationId` on existing `botEmojis`/`runtimeConfig`
  rows. The script fails loudly (aborts, does not partially merge) if it
  finds a `guildId` conflict between source databases, since that would
  indicate two bots already share a guild — the invariant the shared-DB
  approach depends on — rather than silently overwriting one bot's
  `runtimeConfig`/`snippets` rows with another's.
- Add a merged-DB verification script (row counts vs. sum of sources,
  `applicationId` backfill spot-checks, guild-ownership sanity checks)
  that exits non-zero on any mismatch, so it can be scripted as a gate by
  external tooling (see Impact) without a human reading output by hand.
- Add per-bot log/error attribution via an `AsyncLocalStorage`-based bot
  context feeding the pino logger's `mixin()` and a Sentry scope tag.
- Rework `HealthcheckService` to report all bots' status on one shared
  port, with separate `/live` (process-up) and `/ready` (per-bot Discord
  gateway status) endpoints.

## Capabilities

### New Capabilities
- `bot-registry`: loading and validating the multi-bot roster (numbered
  env vars today, with a legacy single-bot fallback; source abstracted
  behind an interface for a future DB-backed registry) and turning each
  entry into a bot's runtime config.
- `multi-bot-runtime`: starting, isolating faults between, and gracefully
  shutting down N Discord bot instances within one process, sharing one
  database connection.
- `bot-observability`: attributing logs, healthcheck status, and captured
  errors to the specific bot instance that produced them.
- `shared-database-scoping`: scoping application-level data (currently just
  `botEmojis`) by bot identity so multiple bots can safely share one SQLite
  file, plus the one-off script to merge existing per-bot databases into it.

### Modified Capabilities
(none — no pre-existing specs in this repo)

## Impact

- Affected code: `src/index.ts`, `src/events.ts`, `src/config/config.ts`,
  `src/models/botConfig.model.ts`, `src/database/schema.ts`,
  `src/repositories/botEmoji.repository.ts`, `src/services/HealthcheckService.ts`,
  `src/utils/logger.ts`.
- New files: `src/config/botRegistry.ts`, `src/utils/botContext.ts`, a
  one-off DB merge script, a merged-DB verification script.
- Database: new Drizzle migration for `botEmojis.applicationId` and
  `runtimeConfig.applicationId`; existing per-bot SQLite files must be
  merged into one shared file before the lisa/bp/twice cutover.
- Deployment: **not a breaking change** for any deployment that doesn't
  opt into the numbered `BOT_1_*`/`BOT_2_*` env vars — `EnvBotRegistry`'s
  legacy fallback means this code can deploy standalone to every existing
  service (lisa, bp, twice, staging) with zero env var or ansible changes,
  each still running as its own single-bot container against its own
  SQLite file. The actual lisa/bp/twice consolidation into one shared
  service is a separate, deliberate cutover done after this code has
  proven itself in that unchanged form (see Migration Plan). Provisioning
  the numbered env vars for the merged service, and decommissioning the
  bp/twice ansible service definitions, is tracked as a separate
  sushii-ansible change (including a temporary migration role for the
  merge/verify/cutover sequence) that consumes the scripts this change
  ships but is not designed here.
- Prerequisite to verify before cutover (not part of this change's code,
  but blocking for it): `DISCORD_CLIENT_ID` is currently hardcoded to the
  same literal value across the lisa/bp/twice/staging ansible templates.
  It's harmless today because nothing reads `discordClientId` in the app,
  but this change makes it load-bearing (roster duplicate-id validation,
  `botEmojis.applicationId` scoping) — the real per-bot client ids need to
  be confirmed from the Discord developer portal and fixed in ansible
  before the lisa/bp/twice merge, or the roster will either reject valid
  config or scope emojis incorrectly.
