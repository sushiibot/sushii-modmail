## 1. `botEmojis` application scoping

- [x] 1.1 Add a **nullable** `applicationId` column to `botEmojis` in `src/database/schema.ts` (not `notNull()` — `botEmojis` already has rows in production via `syncEmojis` running on every startup, and SQLite rejects adding a `NOT NULL` column with no default to a populated table); replace the global `unique()` on `name` with a composite `uniqueIndex` on `(applicationId, name)`
- [x] 1.2 Generate the Drizzle migration (`bun run db:generate`) and verify it applies cleanly via `bun run db:migrate` against a copy of a **populated** production-shaped dev DB (not just an empty one — this is the case that would actually catch a `NOT NULL`-without-default mistake)
- [x] 1.3 Update `BotEmojiRepository` (`src/repositories/botEmoji.repository.ts`) to take `applicationId` in its constructor; scope `getEmoji`/`getEmojis`/`getEmojiMap` `where` clauses by it; include `applicationId` in `saveEmoji`'s insert values and its `onConflictDoUpdate` `set` clause, but **keep the `onConflictDoUpdate` target as `[botEmojis.id]` — do NOT change it to the composite `(applicationId, name)` index**, since `id` is the actual conflicting key for a pre-existing (legacy, `NULL`-owner) row and targeting the composite index instead breaks the upsert for every such row (see design.md §4)
- [x] 1.4 Update `BotEmojiRepository` construction sites in `buildCommandRouter` (`src/index.ts`) and `registerEventHandlers` (`src/events.ts`) to pass `config.discordClientId` as the `applicationId` value (the Discord application id is the bot's application identity — the same id used for `botEmojis.applicationId` scoping)
- [x] 1.5 Add a test reproducing the legacy-row migration path explicitly: seed a `botEmojis` row with `applicationId: NULL` and a known `id`, run `saveEmoji` with that same `id` and a real `applicationId`, and assert it updates in place (claims the row) rather than throwing a unique-constraint error
- [x] 1.6 Update/extend existing `BotEmojiRepository`/`BotEmojiService` tests to cover application-scoped lookups and the composite index's data-integrity behavior (rejecting two different `id`s with the same `name` under the same `applicationId`)

## 1a. `runtimeConfig` guild ownership enforcement

- [x] 1a.1 Add a **nullable** `applicationId: text()` column to `runtimeConfig` in `src/database/schema.ts` (not `notNull()` — every live deployment already has one `runtimeConfig` row per guild; `NULL` means "not yet claimed by any bot")
- [x] 1a.2 Generate the Drizzle migration (`bun run db:generate`) and verify it applies cleanly against a copy of a **populated** production-shaped dev DB with an existing `runtimeConfig` row (can be combined with task 1.2's migration generation into one migration file if generated in the same pass)
- [x] 1a.3 Add a `GuildOwnershipConflictError` type and update `RuntimeConfigRepository` (`src/repositories/runtimeConfig.repository.ts`) to take `applicationId` in its constructor:
  - `getConfig`: if no row exists, keep returning `RuntimeConfig.default(guildId)` unchanged (no DB write); if a row exists with `applicationId` `NULL` or equal to this repository's own, return it normally; if a row exists with a different non-null `applicationId`, throw `GuildOwnershipConflictError`
  - `setConfig`/`toggleAnonymousSnippets`: before the existing `onConflictDoUpdate` upsert, read the current row; if it exists with a different non-null `applicationId`, throw `GuildOwnershipConflictError` without writing; otherwise proceed, including `applicationId: this.applicationId` in both the insert values and the `onConflictDoUpdate` `set` (claims an unclaimed/`NULL` row, reaffirms an already-owned one)
- [x] 1a.4 Update `RuntimeConfigRepository` construction sites (`buildCommandRouter`, `registerEventHandlers`, and any other direct instantiation) to pass `config.discordClientId` as `applicationId`
- [x] 1a.5 Add tests for `RuntimeConfigRepository` covering: no row exists yet (no throw, in-memory default returned); row exists with `NULL` `applicationId` (no throw on read; claimed on next write); row exists with matching `applicationId` (no throw); row exists with a different `applicationId` (both `getConfig` and `setConfig` throw `GuildOwnershipConflictError` without writing)

Note: `GuildOwnershipConflictError` handling under the process-level fault isolation is verified as part of task 5.8, once that machinery exists — it cannot be verified here in group 1a, which lands independently and before group 5's `unhandledRejection`/`uncaughtException` handlers.

## 2. Bot roster configuration

- [x] 2.1 Define `BotRosterEntry` and `BotRegistry` interface (`src/config/botRegistry.ts`) per design.md §1
- [x] 2.2 Implement `EnvBotRegistry`: scan `BOT_${n}_NAME`/`BOT_${n}_DISCORD_TOKEN`/`BOT_${n}_DISCORD_CLIENT_ID`/`BOT_${n}_MAIL_GUILD_ID` from `n = 1` until a gap; validation rejecting duplicate `mailGuildId` (safety-critical) and duplicate `name`/`discordClientId` (integrity); if no `BOT_1_NAME` is present, fall back to a single synthesized entry from legacy `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID`
- [x] 2.3 Add tests for `EnvBotRegistry`: valid numbered roster loads correctly, each duplicate-field case throws, legacy fallback triggers when no `BOT_1_*` vars are set, legacy fallback is *not* used when `BOT_1_*` vars are present (numbered format takes precedence)
- [x] 2.4 Update `src/config/config.ts` env schema: keep `DATABASE_URI`, `LOG_LEVEL`, `HEALTHCHECK_PORT`, `GIT_HASH`, `BUILD_DATE`; make `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID` optional (not required) rather than removing them, since they remain a supported legacy single-bot path
- [x] 2.5 Add `name` field to `BotConfig` (`src/models/botConfig.model.ts`) and a `BotConfig.fromRosterEntry(entry, globals)` factory

## 3. Per-bot log and error attribution

- [x] 3.1 Add `AsyncLocalStorage`-based bot context (`src/utils/botContext.ts`) exposing `runWithBot(name, fn)` / `getCurrentBot()`
- [x] 3.2 Extend the pino `mixin()` in `src/utils/logger.ts` to spread `getCurrentBot()` into every log line's fields
- [x] 3.3 Add a dispatch-wrapping helper used by `registerEventHandlers` (`src/events.ts`) so every `client.on`/`client.once` handler runs inside `runWithBot(config.name, ...)`, without editing each of the existing registration call sites individually
- [x] 3.4 Inside the same wrapper, run the handler in `Sentry.withScope(scope => { scope.setTag('bot', name); ... })` (forked scope, not a mutation of the shared current scope) to avoid cross-bot tag leakage under interleaved async handlers
- [x] 3.5 Add a test verifying two concurrently-dispatched events (different bots) produce log lines/error captures tagged with the correct, non-leaking `bot` value

## 4. Aggregate healthcheck

- [x] 4.1 Change `HealthcheckService` (`src/services/HealthcheckService.ts`) constructor to accept `{ name: string; client: Client }[]` instead of a single `Client`
- [x] 4.2 Add a `/live` route returning 200 whenever the process is running, independent of any bot's Discord connection state
- [x] 4.3 Update `/ready` (and the existing `/health` body) to report a per-bot Discord gateway status array plus an overall summary
- [x] 4.4 Update/add tests for `HealthcheckService` covering multi-bot status aggregation and `/live` staying healthy while one bot is disconnected

## 5. `main()` loop and fault isolation

- [x] 5.1 Extract a `startBot(entry, envConfig, db)` helper in `src/index.ts` that builds `BotConfig`, creates the `Client`, calls `buildCommandRouter`/`registerEventHandlers` (unchanged internals aside from task 3.3's wrapper), and calls `client.login()`
- [x] 5.2 Rewrite `main()` to: call `getDb()` once, instantiate `EnvBotRegistry` and load the roster through the `BotRegistry` interface (so `startBot`/the startup loop depend only on `BotRegistry.getBotConfigs()`, not on `EnvBotRegistry` concretely), start all entries with `Promise.allSettled(roster.map(entry => startBot(...)))`, log and drop failed entries, exit only if every bot failed to start
- [x] 5.3 Wire the multi-client `HealthcheckService` (task 4) into `main()` using the successfully-started instances
- [x] 5.4 Add `process.on("unhandledRejection")` and `process.on("uncaughtException")` handlers that log and continue (do not call `process.exit()`)
- [x] 5.5 Update the shutdown handler to iterate all started instances' `client.destroy()`
- [ ] 5.6 Verify end-to-end locally with the legacy fallback (no `BOT_1_*` vars, only `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID`): confirm behavior matches today's single-bot deployment (per design.md Migration Plan step 2)
- [ ] 5.7 Verify end-to-end locally with `BOT_1_*`/`BOT_2_*` set for two distinct test guilds: confirm both bots connect, relay DMs independently, killing one bot's token doesn't stop the other from starting, and each bot's `messages`/`messageEdits`/`additionalMessageIds` rows stay attributed to the correct thread with no cross-bot collisions during concurrent relay
- [x] 5.8 Add a test/verification that a `GuildOwnershipConflictError` thrown during one bot's event handling (task 1a.3) is caught by this group's fault isolation (logged, that bot's operation aborts) rather than crashing the process or affecting other bots

## 6. Database merge and verification scripts

- [x] 6.1 Write `scripts/merge-bot-dbs.ts`: takes a list of (source SQLite file path, `applicationId`) pairs and an output path, copies rows for `threads`/`snippets`/`runtimeConfig`/`messages`/`messageEdits`/`additionalMessageIds` into the output DB, inserting `threads` rows before their dependent `messages`/`messageEdits`/`additionalMessageIds` rows
- [x] 6.2 Add `guildId` conflict detection across source `threads`/`snippets`/`runtimeConfig` tables that aborts the merge (no partial output file written) and reports the conflicting `guildId` and source files
- [x] 6.3 Backfill `applicationId` on merged `botEmojis` rows and on merged `runtimeConfig` rows (ownership) from each source's paired `applicationId` argument
- [x] 6.4 Ensure the script only ever reads from source files (never writes to them) — operate on paths the operator has already copied, and add a test asserting source file contents are unchanged after a run
- [x] 6.5 Add a test covering: successful merge of two non-conflicting source DBs, an aborted merge (no output file) on a `guildId` conflict, and a 3-source merge (since Migration Plan phase 2 merges lisa/bp/twice in one shot, not pairwise)
- [x] 6.6 Write `scripts/verify-merged-db.ts` per design.md §5: takes the merge output plus the same (source, `applicationId`) args, checks row counts vs. sum of sources, `applicationId` backfill correctness on `botEmojis`/`runtimeConfig`, and no cross-`applicationId` `guildId` collisions; exits non-zero with a machine-readable failure summary on any mismatch, this is the contract external tooling (the ansible follow-up) gates cutover on
- [x] 6.7 Add tests for `verify-merged-db.ts` covering a clean pass and each failure mode (row count mismatch, missing/incorrect `applicationId` backfill, a `guildId` collision that should have been caught by 6.2 but wasn't)

## 7. Handoff to ansible follow-up (out of scope here — tracking only)

- [x] 7.1 Open a tracking issue/PR in sushii-ansible for: (a) the required env-var contract update for the lisa/bp/twice consolidation (`BOT_1_*`/`BOT_2_*`/`BOT_3_*` per design.md §1), (b) fixing the currently-shared `DISCORD_CLIENT_ID` across the lisa/bp/twice/staging templates to real per-bot values (see proposal Impact — this blocks the roster's duplicate-id check from passing), and (c) a temporary migration role implementing the trial/cutover plays from design.md's Migration Plan step 3, built on top of this change's `merge-bot-dbs.ts`/`verify-merged-db.ts` scripts — propose that role as its own change, not part of this one
- [x] 7.2 This code change (through task 6) is deployable to every existing service (lisa, bp, twice, staging) standalone, unchanged, via `EnvBotRegistry`'s legacy fallback — no task here is blocked on the ansible follow-up; only the actual lisa/bp/twice DB consolidation is

## 8. Final verification

- [x] 8.1 Run the full `bun test` suite and confirm no regressions from the DI signature additions (`applicationId`, roster-based `BotConfig`)
- [x] 8.2 Confirm `botEmojis`/`runtimeConfig` migrations apply cleanly on top of an existing single-bot production-shaped dev DB
- [x] 8.3 Document the `BOT_${n}_*` env var scheme, the legacy single-bot fallback, and the merge/verification scripts' CLI contracts in the project README or relevant docs — note that this change deploys standalone (no ansible follow-up required) and only the lisa/bp/twice consolidation needs coordinated ansible work (see proposal Impact)
