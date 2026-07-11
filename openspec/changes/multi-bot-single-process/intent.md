# Intent

**Goal:** Run multiple independent Discord modmail bot instances (distinct
tokens/applications/guilds — e.g. lisa, bp, twice) inside a single Bun
process instead of one container per bot, to cut ops overhead (one process
to deploy/monitor/restart; adding a bot becomes a roster entry instead of a
new service), not to save runtime resources.

**Key decisions:**
- Config source: numbered env vars (`BOT_1_NAME`, `BOT_1_DISCORD_TOKEN`,
  `BOT_1_DISCORD_CLIENT_ID`, `BOT_1_MAIL_GUILD_ID`, `BOT_2_...`) scanned at
  startup, behind a `BotRegistry` interface so it can later be swapped for
  a DB-driven registry without touching `main()`. A JSON roster file was
  considered and rejected — the interface, not the file format, is what
  buys future swappability, and a file would need a new ansible secret-
  provisioning path for no benefit over reusing `.env`.
- **Not breaking**: if no `BOT_1_*` vars are set, the registry falls back
  to a single implicit entry built from the legacy `DISCORD_TOKEN`/
  `DISCORD_CLIENT_ID`/`MAIL_GUILD_ID` vars — every existing deployment
  (lisa, bp, twice, staging) keeps working unchanged, same `.env`, same
  vault template, no ansible edits required to adopt this change's code.
- Roster tokens: stay in `.env`/vault-injected env vars — same trust
  model, same provisioning mechanism as today.
- Database: one shared SQLite file across all bots (rejected per-bot files
  as an antipattern), leaning on the existing guild-scoped schema
  (`threads`, `snippets`, `runtimeConfig` already keyed/PK'd by `guildId`).
- `botEmojis` table (currently unscoped, keyed by emoji name/id only) gets
  an `applicationId` column since these are Discord-application-level
  emojis, not guild-level — needed to avoid collisions once bots share a DB.
- This change includes a one-off script to merge the existing separate
  per-bot SQLite files into the new shared DB (with `applicationId`
  backfilled for pre-existing `botEmojis` rows), run once before cutover.
- Fault isolation: `Promise.allSettled` around each bot's startup (one bad
  token doesn't block others), plus process-level `unhandledRejection`/
  `uncaughtException` handlers that log-and-continue rather than crash the
  whole process — a bug in one bot's handler must not take down every bot.
- Explicitly rejected: running each bot in its own subprocess/worker thread
  for isolation. This would restore crash isolation but requires hand-rolling
  a supervisor (spawn, restart-on-crash, log piping) that duplicates what
  Docker/systemd already provide today — it undercuts the "one process to
  manage" goal. Revisit only if the log-and-continue tradeoff proves
  insufficient in production.
- Healthcheck: one shared HTTP port reporting all bots' status, not one port
  per bot. Split `/live` (process-up) from `/ready` (per-bot Discord gateway
  status) so one bot's transient disconnect doesn't trigger an orchestrator
  restart that kills every other healthy bot.
- Logging/error attribution: `AsyncLocalStorage`-based bot context threaded
  through event dispatch, feeding both the pino logger's existing `mixin()`
  and a Sentry scope tag — gives every log line and captured error a `bot`
  field without re-initializing Sentry/OTel per bot (they stay process-wide
  singletons) and without changing constructor signatures across ~15
  services/controllers.

**Out of scope:**
- sushii-ansible service definition changes (one process/container instead
  of N, shared volume/secrets wiring) — a followup once this code change
  lands.
- Per-bot resource limits / worker-thread or subprocess isolation.
- General multi-tenant SaaS features (self-serve bot onboarding, admin UI
  for the roster) — this is a fixed, ops-managed roster file for a known
  small set of bots.
