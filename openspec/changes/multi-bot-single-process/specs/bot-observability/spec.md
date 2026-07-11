## ADDED Requirements

### Requirement: Per-bot log attribution
The system SHALL tag every log line emitted during a bot's event
processing with that bot's `name`, so log output can be filtered per bot
without changing any service's or controller's constructor signature.

#### Scenario: Log line during event handling
- **WHEN** bot "lisa" processes an incoming DM and a service several
  layers deep logs a message during that processing
- **THEN** the emitted log line includes a `bot: "lisa"` field

### Requirement: Per-bot error attribution
The system SHALL attribute errors captured by the error-reporting pipeline
(Sentry) to the specific bot instance whose event handling raised them,
without re-initializing the error-reporting SDK per bot.

#### Scenario: Error captured during one bot's event handling
- **WHEN** an error occurs while processing an event for bot "bp"
- **THEN** the captured error report is tagged with `bot: "bp"`, and this
  tag does not leak onto errors captured concurrently for other bots

### Requirement: Aggregate healthcheck across all bot instances
The system SHALL expose a single HTTP healthcheck surface, on one shared
port, that reports the status of every running bot instance, and SHALL
distinguish process liveness from per-bot Discord connection readiness.

#### Scenario: Liveness independent of individual bot connection state
- **WHEN** the process is running but one bot instance's Discord gateway
  connection is temporarily disconnected
- **THEN** the `/live` endpoint still returns a healthy (200) response,
  since the process itself is up

#### Scenario: Readiness reflects per-bot status
- **WHEN** a client queries `/ready` while N bots are running with M of
  them connected to Discord
- **THEN** the response includes a per-bot connection status entry for
  each of the N bots and an overall summary
