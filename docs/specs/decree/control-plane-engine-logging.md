---
title: Control Plane Engine — Structured Logging
version: 0.1.0
last_updated: 2026-03-04
status: approved
---

# Control Plane Engine — Structured Logging

## Overview

The engine uses [Pino](https://github.com/pinojs/pino) for structured JSON logging across all
components. A single root logger is created during engine construction and threaded to components as
a dependency. Components create child loggers with bound context fields. Logs are written to a
rotating file via [pino-roll](https://github.com/mcollina/pino-roll), providing a persistent,
queryable record of engine behavior independent of the TUI.

## Constraints

- No wrapper interface — components depend on `pino.Logger` directly.
- Log writing must not block the event loop or interfere with Ink rendering.
- Log point catalogs (which events to log, at what level, with what context) are owned by the
  component specs that produce them — not this spec.

## Specification

### Library

Pino is used directly — no application-level wrapper type. All components declare their logger
dependency as `pino.Logger` (the `Logger` type exported from the `pino` package). The custom
`Logger`, `LogEntry`, `LogWriter`, and `LogLevel` types in `create-logger.ts` are removed.

> **Rationale:** Pino's `Logger` type already provides leveled methods, child loggers, serializers,
> and transport configuration. Wrapping it would create a maintenance burden — especially around
> `child()`, which returns another `Logger` recursively. The existing custom interface was viable
> when logging was limited to 7 error calls; structured lifecycle logging across all components
> requires the full Pino API.

### Root Logger

`createEngine` creates the root Pino instance during engine construction (step 1, before any
components). When `config.logging.enabled` is `true`, the root logger is configured with:

- **Level** from `config.logging.level` (default: `'info'`).
- **File transport** via `pino-roll` (see [File Transport](#file-transport)).
- **Timestamp** using Pino's default (Unix epoch milliseconds in the `time` field). Human-readable
  ISO rendering is a pino-pretty concern and is out of scope for this spec.
- **Error serializer** using Pino's built-in `pino.stdSerializers.err`, keyed as `err`. Pass caught
  errors as `{ err: error }` in log calls to activate the serializer.

When `config.logging.enabled` is `false` (default), the root logger is `pino({ level: 'silent' })` —
no transport, no file I/O.

```ts
import pino from "pino";

// enabled: true
const transport = pino.transport({
  target: "pino-roll",
  options: {
    file: resolve(config.logging.dir, "engine", `engine-${Date.now()}`),
    mkdir: true,
    size: "50m",
    limit: { count: 30, removeOtherLogFiles: true },
  },
});

const logger = pino(
  {
    level: config.logging.level ?? "info",
    serializers: { err: pino.stdSerializers.err },
  },
  transport,
);

// enabled: false (default)
const logger = pino({ level: "silent" });
```

The root logger is passed to components that create their own child loggers. The engine spec owns
the wiring — which component receives the logger — as part of `createEngine` assembly.

### File Transport

Logs are written to a rotating file using `pino-roll` as a Pino transport. Each engine session
writes to a new file, identified by an epoch timestamp in the filename.

| Setting | Value                                      | Description                                                                 |
| ------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `file`  | `{logging.dir}/engine/engine-{epoch}`      | Per-session base filename; `{epoch}` is `Date.now()` at engine construction |
| `size`  | `'50m'`                                    | Rotate when file exceeds 50 MB within a session                             |
| `limit` | `{ count: 30, removeOtherLogFiles: true }` | Retain 30 log files across all sessions; older files are removed            |
| `mkdir` | `true`                                     | Create directories if they do not exist                                     |

Engine logs write to the `engine/` subdirectory under `logging.dir`. Agent session transcripts write
to the `sessions/` subdirectory (see
[agent session logging](./control-plane-engine-agent-session-logging.md)). This isolation prevents
pino-roll's `removeOtherLogFiles` from interfering with session transcript files.

Files on disk follow the pattern `engine-{epoch}.{n}.log`, where `{n}` is a rotation counter (starts
at 1, increments on size-based rotation within a session). Epoch uniqueness is assumed at
millisecond granularity. Tests that construct multiple engine instances must mock `Date.now()` to
return distinct values.

```
logs/
  engine/
    engine-1709568000000.1.log       (session A)
    engine-1709568000000.2.log       (session A, rotated at 50 MB)
    engine-1709654400000.1.log       (session B after restart)
  sessions/
    1709568000000-planner.log
    1709568000000-implementor-42.log
```

> **Rationale:** Per-session files make it easy to correlate logs with a specific engine run.
> `pino-roll` runs in a worker thread via `pino.transport()`, so file I/O does not block the main
> thread — important for a TUI application where synchronous writes would interfere with Ink's
> render loop. `removeOtherLogFiles: true` with a count of 30 prevents unbounded disk growth across
> restarts while retaining enough history for debugging. Subdirectory isolation ensures pino-roll
> only manages engine log files.

### Configuration

The `logging` namespace in `EngineConfig` consolidates all logging configuration. The top-level
`logLevel` field is removed.

```ts
interface LoggingConfig {
  enabled?: boolean; // default: false — enable structured engine log files
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal"; // default: 'info'
  dir?: string; // default: './logs' — directory for all log files
  agentSessions?: boolean; // default: false — enable per-session transcript files
}
```

| Field           | Type      | Default    | Description                                            |
| --------------- | --------- | ---------- | ------------------------------------------------------ |
| `enabled`       | `boolean` | `false`    | Enable structured engine log files                     |
| `level`         | `string`  | `'info'`   | Minimum log level for the root logger                  |
| `dir`           | `string`  | `'./logs'` | Directory for engine log files and session transcripts |
| `agentSessions` | `boolean` | `false`    | Enable per-agent-session transcript files              |

When `config.logging` is omitted or `enabled` is `false` (the default), the root logger is created
with `level: 'silent'` and no transport. Components still receive a valid `pino.Logger` instance —
they do not need conditional logic around log calls. No log files are created and no file I/O
occurs.

`logging.dir` serves as the base directory for all log output. Engine logs write to the `engine/`
subdirectory; agent session transcripts write to the `sessions/` subdirectory. The field is renamed
from `logsDir` to `dir` since it now lives under the `logging` namespace. `createEngine` resolves
`logging.dir` to an absolute path via `path.resolve()` during construction before passing it to the
transport or any component.

> **Rationale:** Consolidating `logLevel` (previously top-level) and `logsDir` (previously
> `logging.logsDir`) under a single `logging` namespace gives logging configuration a single home.

### Levels

Pino's full level set is available: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. The two
additions over the previous custom logger:

- **`warn`** — for situations that are unexpected but not errors (e.g., stale poller data, slow
  command execution, unexpected state that self-corrects).
- **`fatal`** — for unrecoverable errors that precede process exit.

`trace` and `debug` are available but suppressed at the default `info` level. All log points in the
initial spec are `info` or above — no `debug`-level log points are defined. Future additions may
introduce `debug`-level entries if `info` proves too noisy.

### Child Logger Conventions

Components create child loggers with bound context using `logger.child({ ... })`. This spec defines
the **field names** that child loggers bind, so structured log queries are consistent across
components.

| Field         | Type     | Bound by                          | Description                                                 |
| ------------- | -------- | --------------------------------- | ----------------------------------------------------------- |
| `component`   | `string` | All components                    | Component name (e.g., `'specPoller'`, `'commandExecutor'`)  |
| `sessionID`   | `string` | Runtime adapter                   | Agent session identifier                                    |
| `role`        | `string` | Runtime adapter                   | Agent role (`'planner'`, `'implementor'`, `'reviewer'`)     |
| `issue`       | `number` | Runtime adapter, command executor | Work item issue number (omitted for planner — no work item) |
| `eventType`   | `string` | Processing loop                   | Domain event type being processed                           |
| `commandType` | `string` | Command executor                  | Domain command type being executed                          |

Child loggers may be nested. A runtime adapter might create a component-level child
(`{ component: 'runtimeAdapter' }`) and then a per-session child from that
(`{ sessionID, role, issue }`). Pino merges context fields from all ancestors.

Component specs define **when** their child loggers are created and **which** fields they bind. This
spec only standardizes the field names.

### Test Utilities

Replace `createMockLogger` with a factory that returns a silent Pino instance:

```ts
import pino from "pino";

function createTestLogger(): pino.Logger {
  return pino({ level: "silent" });
}
```

Components under test receive a silent logger — log output is suppressed. Per the project's testing
guidelines, tests do not assert on log output.

The existing `createMockLogger` (which tracks calls in an array and uses `vi.fn()`) and its
`MockLogMessage` / `MockLoggerResult` types are removed.

## Acceptance Criteria

- [ ] Given `logging.enabled` is `true`, when the engine starts, then the root logger writes
      JSON-formatted log entries to a per-session file under `logging.dir/engine/` (named
      `engine-{epoch}.1.log`) via the `pino-roll` transport — not to stderr.
- [ ] Given the engine is stopped and restarted, when the new session creates its logger, then it
      writes to a new file with a different epoch — it does not append to the previous session's
      file.
- [ ] Given `logging.dir` does not exist, when the engine starts, then the directory is created
      automatically by the transport.
- [ ] Given more than 30 log files exist in `logging.dir/engine/`, when `pino-roll` rotates, then
      the oldest files are removed to maintain the 30-file limit.
- [ ] Given `logging.level` is set to `'debug'`, when a component logs at `debug` level, then the
      entry appears in the log file. When `logging.level` is `'info'` (default), then `debug`
      entries are suppressed.
- [ ] Given a component creates a child logger with `{ component: 'specPoller' }`, when that child
      logs a message, then the output JSON includes the `component` field merged with the message
      data.
- [ ] Given `logging.level` is omitted from config, when the engine starts, then the root logger
      defaults to `'info'` level.
- [ ] Given `logging.dir` is omitted from config, when the engine starts, then logs are written to
      `'./logs'`.
- [ ] Given `logging.enabled` is `false` (default), when the engine starts, then no log files are
      created, no file I/O occurs, and components still receive a valid `pino.Logger` instance.

## Dependencies

- [control-plane-engine.md](./control-plane-engine.md) — Engine wiring (`createEngine` assembly,
  `EngineConfig` type)
- [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md) —
  Agent session transcript files (shares `logging.dir`)

## References

- [Pino](https://github.com/pinojs/pino) — Structured logging library
- [pino-roll](https://github.com/mcollina/pino-roll) — File rotation transport
- [GitHub Issue #82](https://github.com/zgeoff/decree/issues/82) — Structured application logs
