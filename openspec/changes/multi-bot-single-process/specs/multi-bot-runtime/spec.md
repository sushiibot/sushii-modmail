## ADDED Requirements

### Requirement: Concurrent independent bot instances in one process
The system SHALL support running one independent Discord bot instance
(client, command router, event handlers) per roster entry, all within a
single process, sharing a single database connection. Each instance's
behavior SHALL be equivalent to today's single-bot behavior for its own
guild, with no cross-instance interference in command handling, message
relay, or thread state.

#### Scenario: Two bots operate independently
- **WHEN** the process starts with a two-entry roster, each pointing at a
  distinct guild
- **THEN** each bot logs into Discord with its own token, relays DMs to its
  own guild's forum threads, and responds to its own guild's commands,
  with neither bot's activity visible to or affecting the other

### Requirement: Per-bot startup fault isolation
The system SHALL isolate startup failures per bot instance: a failure to
log in or initialize one bot SHALL NOT prevent other roster entries from
starting.

#### Scenario: One bot has an invalid token
- **WHEN** the roster contains one entry with an invalid Discord token and
  one entry with a valid token
- **THEN** the process logs an error for the failing entry, continues
  starting the remaining entries, and does not exit as long as at least
  one bot started successfully

#### Scenario: All bots fail to start
- **WHEN** every roster entry fails to start
- **THEN** the process logs the failures and exits with a non-zero status

### Requirement: Runtime fault isolation between bot instances
The system SHALL prevent an unhandled error in one bot instance's event
handling from crashing the entire process and taking down other running
bot instances.

#### Scenario: Unhandled rejection in one bot's event handler
- **WHEN** an event handler for bot A throws an unhandled promise rejection
- **THEN** the process logs the error and continues running; bot B's
  connection and event handling are unaffected

### Requirement: Graceful shutdown of all instances
The system SHALL, on receiving `SIGINT` or `SIGTERM`, shut down every
running bot instance before the process exits.

#### Scenario: Shutdown signal received with multiple bots running
- **WHEN** the process receives `SIGTERM` while N bots are running
- **THEN** the system calls `client.destroy()` for all N clients before
  exiting
