## ADDED Requirements

### Requirement: Application-scoped emoji records
The system SHALL scope `botEmojis` records by the owning Discord
application, so multiple bot instances (distinct Discord applications)
sharing one database file cannot read, overwrite, or collide on each
other's emoji records.

#### Scenario: Two bots register an emoji with the same name
- **WHEN** bot A (application id X) and bot B (application id Y) each
  register their own application emoji named `:wave:`
- **THEN** both records are stored without a uniqueness conflict, and each
  bot's emoji lookups only ever return its own application's record

#### Scenario: Emoji lookup does not cross bot boundaries
- **WHEN** bot A looks up an emoji by name
- **THEN** the lookup is scoped to application id X and never returns a
  record belonging to a different application id, even if a
  same-named emoji exists for another bot

### Requirement: Guild ownership enforcement on `runtimeConfig`
The system SHALL record which bot instance (by Discord application id)
owns each guild's `runtimeConfig` row, and SHALL reject any read or write
of that row by a different bot instance, rather than relying solely on
roster-level uniqueness validation (see `bot-registry` capability) to
prevent cross-bot access to `threads`/`snippets`/`runtimeConfig`.

#### Scenario: No row exists yet
- **WHEN** a bot instance reads config for a guild that has no
  `runtimeConfig` row at all
- **THEN** the system returns default configuration values without
  creating a row or raising an ownership error

#### Scenario: Pre-existing row with no recorded owner
- **WHEN** a bot instance reads or writes a `runtimeConfig` row that
  exists but has no `applicationId` recorded (e.g. a row that predates
  this capability)
- **THEN** the read succeeds without error, and a write claims the row by
  recording the writer's application id as the owner

#### Scenario: Ownership recorded on first write to an unclaimed row
- **WHEN** a bot instance writes to a guild's `runtimeConfig` row that has
  no recorded owner (whether newly created or pre-existing and unclaimed)
- **THEN** the row records that bot's application id as the owner

#### Scenario: Conflicting access is rejected
- **WHEN** a bot instance attempts to read or write a `runtimeConfig` row
  whose recorded owner is a different application id
- **THEN** the system rejects the operation with an ownership-conflict
  error rather than returning or overwriting the other bot's data

#### Scenario: Roster validation alone is not the enforcement mechanism
- **WHEN** two bot instances are, through misconfiguration or roster
  drift after initial validation, both directed at the same guild
- **THEN** the ownership check on `runtimeConfig` still prevents one bot
  from silently reading or overwriting the other's settings, independent
  of whether the roster-level uniqueness check ran or was bypassed

### Requirement: Transitive message scoping requires no schema change
The system SHALL rely on `messages`, `messageEdits`, and
`additionalMessageIds` being scoped transitively through their parent
`threads` row (`threadId` → `threads.guildId`) and on Discord message/thread
snowflakes being globally unique, rather than adding a direct scoping
column to these tables.

#### Scenario: No cross-bot collision on message records
- **WHEN** two bots, each owning a distinct guild's `runtimeConfig` row,
  relay messages into their own threads
- **THEN** their `messages`/`messageEdits`/`additionalMessageIds` rows
  never collide, since Discord message and thread ids are globally unique
  regardless of which bot created them

### Requirement: One-off merge script for existing per-bot databases
The system SHALL provide a script that merges existing separate per-bot
SQLite database files into one shared database file, backfilling the
`applicationId` scoping on `botEmojis` rows and the ownership
`applicationId` on `runtimeConfig` rows, for one-time use before cutover
to the shared-database deployment.

#### Scenario: Successful merge
- **WHEN** the script is run against copies of N existing per-bot database
  files, each paired with its bot's `applicationId`, and no `guildId`
  appears in more than one source file
- **THEN** the script produces one merged database file containing all
  guild-scoped rows from every source, with every `botEmojis` row and
  every `runtimeConfig` row labeled with its source bot's `applicationId`

#### Scenario: Guild id conflict across source databases
- **WHEN** the same `guildId` is found in more than one source database's
  `threads`, `snippets`, or `runtimeConfig` table
- **THEN** the script aborts without writing any output file and reports
  the conflicting `guildId` and source files, rather than silently
  overwriting one bot's data with another's

#### Scenario: Source files are never modified
- **WHEN** the script is run against a set of source database file paths
- **THEN** every source file's contents are byte-for-byte unchanged after
  the script completes (successfully or by aborting), whether the script
  is pointed at the original files or copies of them
