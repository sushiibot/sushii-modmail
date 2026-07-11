## Context

sushii-modmail today is a single-tenant process: `main()` in `src/index.ts`
reads one bot's config from `process.env`, opens one SQLite file, creates
one `discord.js` `Client`, and wires it through two composition-root
functions, `buildCommandRouter(config, client, db)` (`src/index.ts:41-121`)
and `registerEventHandlers(config, client, db, router)` (`src/events.ts:59-138`).
Every service, controller, and repository underneath those two functions is
constructed via constructor injection, taking `config`/`client`/`db` as
explicit arguments — there is no module-level singleton client, db, or
config anywhere in the codebase. This is the key enabling fact for this
design: calling those two functions N times with N different
`(config, client, db)` tuples produces N fully independent listener sets
with no code changes to either function's internals.

The database schema is already partially multi-tenant: `threads`,
`snippets`, and `runtimeConfig` (whose primary key literally is `guildId`)
are guild-scoped. `messages`/`messageEdits` scope transitively via
`threadId` → `threads.guildId` (safe, since Discord snowflakes are globally
unique). The one gap is `botEmojis` (`src/database/schema.ts:208-212`),
which stores Discord *application*-level emojis (uploaded via
`client.application.emojis.create`, see `src/services/BotEmojiService.ts`)
keyed only by `name`/`id` with a global `unique()` on `name` — this table
was never guild-scoped because application emojis aren't guild concepts,
and it will collide once two bots (two Discord applications) share a DB.

## Goals / Non-Goals

**Goals:**
- Run N independently-configured Discord bot instances in one Bun process,
  sharing one database connection, with each bot's runtime behavior
  unchanged from today.
- Keep `main()`'s composition roots (`buildCommandRouter`,
  `registerEventHandlers`) unchanged in what they construct and wire —
  call them once per roster entry instead of once globally. The one
  addition inside `registerEventHandlers` is a thin dispatch wrapper
  (§6) for bot-context propagation; it does not change which
  services/controllers/listeners are built.
- Make the roster source swappable later (file → DB-backed) without
  touching `main()`.
- One bot's startup failure, or an uncaught error in one bot's event
  handler, must not prevent the other bots from running.
- Every log line, healthcheck response, and captured error must be
  attributable to the specific bot instance it came from.

**Non-Goals:**
- True process/OS-level fault isolation between bots (subprocesses, worker
  threads). Explicitly rejected — see Decisions.
- Per-bot resource limits (memory, CPU).
- A generalized multi-tenant SaaS platform (self-serve onboarding, admin
  UI for the roster, arbitrary numbers of guilds per bot).
- sushii-ansible service definition changes — tracked as a required
  follow-up (see proposal Impact) but not designed here.

## Decisions

### 1. Roster config: `BotRegistry` interface + `EnvBotRegistry` (numbered env vars, legacy fallback)

```ts
interface BotRosterEntry {
  name: string;            // stable id for logs/health, e.g. "lisa"
  discordToken: string;
  discordClientId: string; // Discord application id
  mailGuildId: string;
}
interface BotRegistry {
  getBotConfigs(): BotRosterEntry[] | Promise<BotRosterEntry[]>;
}
```

`EnvBotRegistry` reads `process.env` directly — no new file format, no new
ansible secret-provisioning path. It scans `BOT_${n}_NAME` starting at
`n = 1`, building one `BotRosterEntry` per index (`BOT_${n}_DISCORD_TOKEN`,
`BOT_${n}_DISCORD_CLIENT_ID`, `BOT_${n}_MAIL_GUILD_ID`) until it hits a gap.
**If no `BOT_1_NAME` is set at all**, it falls back to synthesizing a single
implicit roster entry from the legacy `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/
`MAIL_GUILD_ID` vars (named e.g. `"default"`, or `config.name` may be left
unset and default in `BotConfig`). This fallback is what makes the change
non-breaking: a deployment that never adopts `BOT_1_*` vars keeps running
exactly as it does today, same `.env`, same secrets, same vault template.

On load, `EnvBotRegistry` rejects the roster (throws, process exits before
any bot starts) if any two entries share a `mailGuildId` — this is the
safety-critical check, enforcing the one-guild-per-bot invariant the
shared-DB design depends on (§4 below). It additionally rejects duplicate
`name`/`discordClientId` as basic data integrity hygiene (distinct
log/health identifiers, distinct Discord applications) — a strictly
stronger check than the proposal's stated `mailGuildId` requirement, not a
deviation from it. Note: this duplicate-`discordClientId` check will
reject the *current* lisa/bp/twice/staging ansible templates as-is, since
they share one hardcoded `DISCORD_CLIENT_ID` value today — that's a latent
bug in those templates (currently harmless because nothing reads
`discordClientId`) that must be fixed with the real per-bot client ids
before the multi-entry roster is populated (see proposal Impact).

A JSON-file-based roster (originally considered here) was rejected in
favor of env vars: the `BotRegistry` interface is what buys swappability
for a future DB-backed registry, not the file format, so a JSON file would
only have added a new ansible secret-provisioning mechanism (bind-mounted
file, permissions, vault templating for a blob) for no benefit over
reusing the `.env` vault pattern every other service already has.

`src/config/config.ts`'s env schema keeps `DATABASE_URI`, `LOG_LEVEL`,
`HEALTHCHECK_PORT`, `GIT_HASH`, `BUILD_DATE` as process-wide settings, and
keeps `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`MAIL_GUILD_ID` as optional
(rather than required) for the legacy single-bot fallback path — they are
no longer required at the schema level, but remain a valid, fully
supported way to run one bot. `BotConfig` (`src/models/botConfig.model.ts`)
gains a `name` field and a `BotConfig.fromRosterEntry(entry, globals)`
factory alongside `fromConfigType`.

### 2. `main()` loop with per-bot fault isolation

`getDb(envConfig.DATABASE_URI)` is called once, before the loop — not once
per bot. Each roster entry then goes through:

```ts
async function startBot(entry, envConfig, db) {
  const config = BotConfig.fromRosterEntry(entry, envConfig);
  const client = new Client({ /* same intents/partials as today */ });
  const router = buildCommandRouter(config, client, db);
  registerEventHandlers(config, client, db, router);
  await client.login(config.discordToken);
  return { config, client };
}
```

`main()` calls `Promise.allSettled(roster.map(entry => startBot(entry, ...)))`,
logs and drops any rejected entry, and only exits the process if *every*
bot failed to start. This restores, inside one process, the startup-level
fault isolation that used to come free from separate containers.

Process-level `unhandledRejection`/`uncaughtException` handlers are added
(they don't exist today, since a crash previously just took down one
container). They log-and-continue rather than `process.exit()` — an error
in bot A's event handler must not kill bot B. This is a deliberate,
incomplete mitigation (see Risks) — it does not catch every possible crash
mode (e.g. a synchronous stack overflow still kills the whole process), but
covers the common case of an unhandled promise rejection deep in a
discord.js event callback.

Shutdown (`SIGINT`/`SIGTERM`) iterates all started instances and calls
`client.destroy()` on each before exiting.

### 3. Rejected alternative: subprocess/worker-thread-per-bot

Considered explicitly and rejected. Running each bot as a `Bun.spawn`
subprocess or a `worker_thread` would restore full crash isolation, but
requires building a mini process-manager (spawn, restart-on-crash policy,
log piping/aggregation, no IPC needed today but plan for it) inside the
application — largely duplicating what Docker/systemd already provide.
That directly undercuts the stated goal of this change (fewer moving parts
to operate). If the log-and-continue tradeoff in §2 proves insufficient in
production (repeated cross-bot incidents from one bot's bugs), revisit this
as a follow-up; it is not part of this change.

### 4. Shared database: guild ownership enforcement + `botEmojis` scoping fix

One shared SQLite file, per the proposal. `threads`/`snippets`/`runtimeConfig`
are already keyed by `guildId`, but relying solely on the `BotRegistry`
uniqueness check (§1) to guarantee no two bots ever serve the same guild is
not enough on its own — that check only runs against the roster env vars at
process startup. It doesn't protect against: the roster being edited later
to reassign a guild without anyone reconciling existing DB rows, a future
DB-backed `BotRegistry` implementation forgetting to replicate the check
(nothing in the `BotRegistry` interface requires it), or any other path
that writes to these tables outside a freshly-validated startup. None of
these are exotic — they're the normal way config drifts over time — so the
invariant needs a backstop at the data layer, not just at config-load time.

**Guild ownership column on `runtimeConfig`.** Add a **nullable**
`applicationId: text()` to `runtimeConfig` (`src/database/schema.ts`) —
nullable specifically so the migration is a plain `ADD COLUMN`, valid
against an already-populated production table (SQLite rejects
`NOT NULL` columns added without a default to a non-empty table, and
`runtimeConfig` already has one row per guild in every current
deployment). `NULL` means "not yet claimed by any bot" and is the
expected state for every pre-existing row immediately after this
migration runs — there is no separate backfill step for the live
single-bot migration in Migration Plan step 1; ownership is claimed
lazily.

`RuntimeConfigRepository` (`src/repositories/runtimeConfig.repository.ts`)
takes `applicationId` in its constructor (same pattern as `BotEmojiRepository`,
§below) and enforces, for both `getConfig` and `setConfig`/`toggleAnonymousSnippets`:
- **Read** (`getConfig`): if no row exists, return the existing in-memory
  `RuntimeConfig.default(guildId)` unchanged (no DB write, no check — this
  is the existing behavior for a genuinely new guild). If a row exists
  with `applicationId` either `NULL` or equal to this repository's own
  `applicationId`, return it normally. If a row exists with a different,
  non-null `applicationId`, throw `GuildOwnershipConflictError` instead of
  returning another bot's settings.
- **Write** (`setConfig`/`toggleAnonymousSnippets`): before the existing
  `onConflictDoUpdate` upsert, read the current row. If it exists with a
  different non-null `applicationId`, throw `GuildOwnershipConflictError`
  without writing. Otherwise proceed with the upsert, including
  `applicationId: this.applicationId` in both the insert values and the
  `onConflictDoUpdate` `set` — this claims an unclaimed (`NULL`) row on
  first write and reaffirms an already-owned row, with no separate
  "first creation" code path needed.

This is a read-then-write check, not an atomic constraint — acceptable
here because, by construction, only one bot's `RuntimeConfigRepository`
instance is ever expected to write to a given guild's row (the roster
check in §1 prevents two bots from being configured for the same guild in
the first place); this check is the backstop for when that assumption is
violated, not a concurrency-control mechanism for legitimate concurrent
writers.

`ThreadService`/`MessageRelayService`/`CommandRouter`/`SettingsService` all
call through `RuntimeConfigRepository` before doing any guild-scoped
work (thread creation, message relay, permission checks), so this one
check point gates `threads`/`snippets` access transitively without needing
a schema change on those two tables — a bot can't get far enough to touch
`threads`/`snippets` for a guild it doesn't own without first hitting the
ownership check on `runtimeConfig`.

This makes the `BotRegistry` roster check (§1) a fast preflight that
prevents an obviously-misconfigured roster from starting at all, while the
`runtimeConfig.applicationId` check is the actual, permanently-enforced
guarantee — it holds regardless of how the roster was loaded or whether it
changed after the DB already had data.

Alternative considered: add `applicationId` to `threads` and `snippets`
directly instead of (or in addition to) `runtimeConfig`. Rejected for this
change — `runtimeConfig` is read on every guild-scoped code path already
(it's the settings/permissions source of truth), so gating there catches
the same violations with one column change instead of three, at the cost
of not independently protecting `threads`/`snippets` if some future code
path reads them without going through `RuntimeConfigRepository` first.
Revisit if such a path appears.

`botEmojis` scoping change (`src/database/schema.ts:208-212`):
- Add a **nullable** `applicationId: text()` column, scoped by Discord
  application (i.e. `config.discordClientId`), not guild — these are
  application-level emoji uploads, not guild data. Nullable for the same
  reason as `runtimeConfig.applicationId` above: `syncEmojis` runs on
  every startup (`src/events.ts:156`), so `botEmojis` already has rows in
  every current production deployment, and a `NOT NULL` column with no
  default cannot be added to a populated SQLite table. Existing rows
  migrate to `NULL`.
- Change the unique constraint from `name: text().notNull().unique()` to a
  composite `uniqueIndex("bot_emojis_app_name_idx").on(applicationId, name)`
  — a plain data-integrity constraint (rejects two distinct `id`s claiming
  the same name under the same application). The `id` (Discord snowflake)
  stays the primary key.
- Generate the migration via `bun run db:generate` (drizzle-kit).
- `BotEmojiRepository` (`src/repositories/botEmoji.repository.ts`) takes
  `applicationId` in its constructor. `getEmoji`/`getEmojis`/`getEmojiMap`
  add `eq(botEmojis.applicationId, this.applicationId)` to their `where`
  clauses — a `NULL`-owner legacy row simply won't match until claimed.
  `saveEmoji`'s insert includes `applicationId`, but its
  `onConflictDoUpdate` **target stays `[botEmojis.id]`, unchanged from
  today** — it must NOT target the new composite index. `id` is a Discord
  snowflake and already globally unique, so a conflict on `id` can only
  mean "this exact emoji record already exists" (created earlier by this
  same bot, or pre-populated by the merge script), never a genuine
  cross-bot collision — always safe to update. Targeting the composite
  index instead would break the common legacy-row case:
  `BotEmojiController.syncEmojis`'s "Discord already has this emoji, DB
  lookup misses because the legacy row's `applicationId` is `NULL`" branch
  calls `saveEmoji` with that emoji's *existing* `id` — a real conflict on
  the `id` primary key that an `ON CONFLICT (applicationId, name)` clause
  does not match, since `(NULL, name)` isn't equal to `(ownId, name)` even
  though the row's `id` is identical. That would surface as a raw
  `UNIQUE constraint failed: bot_emojis.id` error instead of updating,
  i.e. an unhandled exception on the first post-migration `syncEmojis`
  call for essentially every pre-existing deployment. Keeping the conflict
  target on `id` (with `applicationId` added to the `set` clause) means
  every `saveEmoji` call — claiming a legacy `NULL` row or reaffirming an
  already-owned one — updates `applicationId` in place with no thrown
  error, which is what makes the migration self-healing for `botEmojis`
  without needing an explicit `NULL`-is-unclaimed *read* path the way
  `runtimeConfig` does (§4 above) — `syncEmojis` always performs a
  save/claim on startup regardless of what the scoped read found.
  Construction sites in `buildCommandRouter`/`registerEventHandlers` pass
  `config.discordClientId`. `DiscordBotEmojiService`/`BotEmojiController`
  need no changes — they only ever see an already-scoped repository.

### 5. One-off DB merge script + merged-DB verification script

Two separate scripts, both designed to be called by external tooling
(the ansible follow-up, §Migration Plan step 4) rather than run
interactively — both are read-only on their source files, so both are
safe to run repeatedly against live-bot copies without any coordination
with the running containers.

**`scripts/merge-bot-dbs.ts`** reads each existing per-bot SQLite file and
inserts its rows into a new shared DB file:
- For `botEmojis` rows, backfill `applicationId` from the source bot's
  known `discordClientId` (passed as a script argument per source file)
  before inserting.
- For `threads`/`snippets`/`runtimeConfig` (`guildId`-keyed), the script
  aborts the whole merge (no partial writes) if it finds the same
  `guildId` present in more than one source database — that would mean
  two bots already serve the same guild, violating the invariant this
  design depends on, and needs manual resolution rather than a silent
  overwrite.
- Backfills `runtimeConfig.applicationId` from the same per-source-file
  `applicationId` argument used for `botEmojis`, so every merged guild's
  ownership is recorded from the moment the shared DB goes live.
- `messages`/`messageEdits`/`additionalMessageIds` ride along with their
  parent `threads` rows once the `guildId` check above passes — they're
  keyed by globally-unique Discord snowflakes (`threadId`/`messageId`), so
  no additional per-table conflict check is needed; the script inserts
  them after their parent `threads` rows to satisfy the FK.
- Takes an explicit output path and never writes to its source files —
  callers (human or ansible) always run it against copies.
- Idempotent/rerunnable: given the same sources, produces an equivalent
  output every time, so it can be run speculatively during an ansible
  trial play and then re-run for real at cutover without special-casing.

**`scripts/verify-merged-db.ts`** takes the merge script's output (plus
the same source files/args) and checks it programmatically instead of
requiring a human to eyeball it:
- Row counts per table match the sum of the sources.
- Every `botEmojis`/`runtimeConfig` row that should have been claimed has
  the expected `applicationId`.
- No `guildId` appears under more than one `applicationId` in the merged
  `runtimeConfig`.
- Exits non-zero with a machine-readable summary of what failed on any
  mismatch, exits 0 with a summary of what was checked on success — this
  is the contract the ansible follow-up's cutover play gates on before it
  will point `DATABASE_URI` at the merged file.

### 6. Per-bot log/error attribution: `AsyncLocalStorage`, not threaded params

Every service/controller does its own `getLogger(this.constructor.name)`
call against the module-level pino root logger (`src/utils/logger.ts`).
Passing a per-bot child logger through ~15 constructors would touch every
service/controller signature for no behavioral gain. Instead:
- New `src/utils/botContext.ts`: `AsyncLocalStorage<{ bot: string }>` with
  `runWithBot(name, fn)` / `getCurrentBot()`.
- `registerEventHandlers` wraps each `client.on`/`client.once` dispatch
  (via a small local helper wrapping registration, not editing all ~10
  call sites individually) in `runWithBot(config.name, () => handler(...))`.
- `logger.ts`'s existing `mixin()` (already used to inject OTel
  `trace_id`/`span_id`) is extended to also spread `getCurrentBot()` — every
  log line anywhere in the call stack gets a `bot` field automatically.
- Sentry: the wrapped dispatch runs the handler inside
  `Sentry.withScope(scope => { scope.setTag('bot', name); ... })` (a forked,
  per-call scope), not a mutation of the shared current scope — mutating a
  shared scope would risk cross-bot mistagging if two bots' async event
  handlers interleave on the event loop (e.g. one dispatch is mid-`await`
  when another bot's event fires). `withScope` scopes the tag to exactly
  the one dispatch's execution, so captured errors are attributable per bot
  without re-initializing the SDK per bot and without cross-talk.

Sentry (`Sentry.init()`) and OTel (`setupOtel()`) both stay process-wide
singletons, initialized once in `main()`, unchanged — only the per-event
scope tag varies.

### 7. Healthcheck: one shared port, split liveness/readiness

`HealthcheckService` (`src/services/HealthcheckService.ts`) changes from
taking one `Client` to taking `{ name: string; client: Client }[]`, served
on one shared port (not one port per bot — matches the "one process to
manage" goal and avoids a roster misconfiguration class of port
collisions).
- `/live`: 200 as long as the process is running — used for container
  liveness/restart policy. Must NOT depend on any individual bot's Discord
  connection state.
- `/ready` (and the existing `/health` body, extended): per-bot Discord
  gateway status plus an overall summary. A single bot's transient
  disconnect must not make `/live` fail and trigger an orchestrator
  restart that kills every other healthy bot — this is why liveness and
  readiness are split rather than reusing one endpoint for both.

## Risks / Trade-offs

- **[Risk] Shared process memory**: one bot's cache growth (large guild
  member/message caches) is shared process memory with every other bot; an
  OOM kill takes down all bots at once, not one. → **Mitigation**: none at
  the code level for this change; monitor via existing Grafana dashboards,
  revisit subprocess isolation (§3) if this becomes a recurring problem.
- **[Risk] Synchronous/unrecoverable crash**: a crash Node can't route
  through `unhandledRejection`/`uncaughtException` (e.g. a stack overflow)
  still kills the whole process and every bot with it. → **Mitigation**:
  none within this change's scope; this is the core tradeoff being made
  in exchange for lower ops overhead, and is called out explicitly so
  operators understand a catastrophic bug now has multi-tenant blast
  radius.
- **[Risk] Roster misconfiguration or drift**: an operator adds two roster
  entries pointing at the same guild, or a guild gets reassigned to a
  different bot later without reconciling existing DB rows.
  → **Mitigation**: two layers. `BotRegistry` validates uniqueness of
  `mailGuildId` (and `name`/`discordClientId`) at load time and refuses to
  start a misconfigured roster. Independently, `runtimeConfig.applicationId`
  (§4) enforces ownership on every read/write at the data layer, so even a
  roster that passes the startup check (or a future `BotRegistry`
  implementation that skips the check entirely) can't cause one bot to
  silently read or overwrite another bot's guild data — it fails loudly
  with a `GuildOwnershipConflictError` instead.
- **[Non-issue after §1's rewrite] Secret handling surface**: with
  `EnvBotRegistry`, bot tokens stay in `.env`/vault-injected env vars —
  same trust model, same provisioning mechanism as today, just numbered
  (`BOT_1_DISCORD_TOKEN`, `BOT_2_...`) instead of singular. No new secret
  file, no new ansible provisioning path. (Superseded the JSON-roster-file
  version of this risk from an earlier draft.)
- **[Non-issue after §1's rewrite] Standalone deployability.** Because
  `EnvBotRegistry` falls back to the legacy single-bot env vars when no
  `BOT_1_*` vars are set, this change's code *can* deploy standalone to
  every existing service with zero env var or ansible changes — see
  Migration Plan.

## Migration Plan

This change ships in two phases, deliberately not a three-way (lisa → +bp
→ +twice) incremental rollout: per-bot phasing was considered but adds
repeated manual stop/copy/merge/verify/redeploy cycles for marginal extra
safety over merging all three at once, since the merge script's
`guildId`-conflict check protects a 3-way merge exactly as well as a
2-way one. The phasing that *does* matter is separating "prove the new
code is behaviorally identical" (zero data risk) from "the one actual data
migration" (real but one-shot, with a fast rollback path).

1. Land the `botEmojis` and `runtimeConfig` migrations + their repository
   scoping/ownership changes first — independent of everything else,
   backwards compatible with the current single-bot single-DB deployment.
   Both new `applicationId` columns are **nullable** (not `notNull()`),
   since both tables already have rows in every live deployment
   (`runtimeConfig` has one row per guild; `botEmojis` is populated by
   `syncEmojis` on every startup) and SQLite rejects adding a `NOT NULL`
   column with no default to a non-empty table. Existing rows migrate to
   `NULL` and get claimed by the single existing bot on its next write
   (`runtimeConfig`) or next emoji sync (`botEmojis`) — no separate
   backfill step needed for this migration step.
2. Land `BotRegistry`/`EnvBotRegistry`, `BotConfig.fromRosterEntry`, the
   `AsyncLocalStorage` bot context + logger/Sentry tagging, the
   `HealthcheckService` multi-client refactor, **and** the `main()` loop
   rewrite together as one deployable unit — the loop is what actually
   consumes `BotRegistry`, so it can't be verified in isolation from it.
   Because of `EnvBotRegistry`'s legacy fallback (§1), this unit deploys
   to every existing service (lisa, bp, twice, staging included)
   **unchanged**: no `BOT_1_*` vars, no ansible edits, roster-of-one
   degenerates to exactly today's single-bot behavior. This is Phase 1 —
   it validates the rewrite in production, for every bot, with zero data
   migration risk, before any DB merge happens.
3. Phase 2 — the lisa/bp/twice consolidation — is the one real data
   cutover, done once (not per-bot) after Phase 1 has run clean for a
   while:
   - Confirm the `DISCORD_CLIENT_ID` values in the lisa/bp/twice ansible
     templates are fixed to their real, distinct per-bot ids (see
     proposal Impact — they currently share one hardcoded value, which
     `EnvBotRegistry`'s duplicate-`discordClientId` check will reject).
   - Run the merge script (§5) against copies of the three live SQLite
     files, then the verification script (§5) against the output; both
     are safe to run repeatedly against copies with the source bots still
     running, since the script never writes to its sources.
   - At the actual cutover: stop the three source containers, re-run
     copy+merge+verify one final time against the now-static files
     (a pre-stop trial copy is stale the instant the source bots resume
     writing, so the real merge must happen post-stop), then start the
     new consolidated service with `BOT_1_*`/`BOT_2_*`/`BOT_3_*` pointed
     at the merged file.
   - Rollback: the old lisa/bp/twice containers/services are stopped, not
     deleted, until the consolidated service is confirmed stable — rollback
     is starting them back up against their still-intact original DB
     files. Decommissioning those ansible service definitions happens only
     after confirmation.
4. The ansible-side orchestration of Phase 2 (a temporary migration role
   with a non-destructive trial play that runs merge+verify against copies
   with the old bots untouched, and a cutover play that does the
   stop/merge/start/verify/rollback sequence) is **out of scope for this
   change** — tracked as a separate sushii-ansible change that consumes
   the merge and verification scripts this change ships. This change's
   scope ends at producing those scripts and making them independently
   runnable/testable; it does not implement the ansible role itself.

## Open Questions

- Should the roster support per-bot log level overrides, or is one
  process-wide `LOG_LEVEL` sufficient? Current design assumes the latter
  (simpler); revisit if a bot needs more verbose logging in isolation.
- Exact form of the merged-DB verification script's output (human-readable
  report vs. machine-parseable exit-code/JSON for the ansible follow-up to
  gate on) — leaning machine-parseable since ansible will script off it,
  but not finalized; see tasks.md.
