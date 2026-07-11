## ADDED Requirements

### Requirement: Roster-based bot configuration
The system SHALL load the set of bot instances to run from a `BotRegistry`
implementation rather than from single-bot environment variables. Each
entry returned by the registry SHALL provide, at minimum, a stable `name`,
a Discord bot token, a Discord application id, and a mail guild id.

#### Scenario: Roster loaded from numbered env vars
- **WHEN** the process starts with `BOT_1_NAME`, `BOT_1_DISCORD_TOKEN`,
  `BOT_1_DISCORD_CLIENT_ID`, `BOT_1_MAIL_GUILD_ID` set (and optionally
  `BOT_2_*`, `BOT_3_*`, ... contiguously)
- **THEN** `EnvBotRegistry` returns one `BotRosterEntry` per contiguous
  `BOT_${n}_*` group, stopping at the first gap in `n`

#### Scenario: Legacy single-bot fallback
- **WHEN** the process starts with no `BOT_1_NAME` set, but
  `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `MAIL_GUILD_ID` are set
- **THEN** `EnvBotRegistry` returns a single synthesized `BotRosterEntry`
  built from those legacy vars, and the process behaves identically to
  today's single-bot deployment

#### Scenario: Numbered format takes precedence over legacy vars
- **WHEN** both `BOT_1_NAME` (numbered format) and `DISCORD_TOKEN` (legacy
  format) are set
- **THEN** `EnvBotRegistry` uses the numbered `BOT_${n}_*` entries and
  ignores the legacy vars

#### Scenario: Startup depends only on the BotRegistry interface
- **WHEN** the process starts with any object implementing
  `BotRegistry.getBotConfigs()` (whether `EnvBotRegistry` or another
  implementation)
- **THEN** the same `BotRosterEntry[]` result, regardless of source,
  produces the same set of started bot instances

### Requirement: Roster validation rejects unsafe configurations
The system SHALL validate the full roster at load time, before any bot
instance is started, and SHALL refuse to start any bot if the roster is
invalid.

#### Scenario: Duplicate mail guild id
- **WHEN** two or more roster entries specify the same `mailGuildId`
- **THEN** `BotRegistry` throws a validation error identifying the
  conflicting entries and the process exits before any bot logs in

#### Scenario: Duplicate bot name or application id
- **WHEN** two or more roster entries specify the same `name` or the same
  `discordClientId`
- **THEN** `BotRegistry` throws a validation error and the process exits
  before any bot logs in

#### Scenario: Malformed or incomplete numbered roster
- **WHEN** `BOT_2_NAME` is set but one of `BOT_2_DISCORD_TOKEN`/
  `BOT_2_DISCORD_CLIENT_ID`/`BOT_2_MAIL_GUILD_ID` is missing
- **THEN** `EnvBotRegistry` throws a descriptive error identifying the
  incomplete entry and the process exits before any bot logs in
