---
title: Control Plane Engine
version: 1.0.0
last_updated: 2026-02-18
status: approved
---

# Control Plane Engine

## Overview

The engine is the core module of the control plane. It wires together all v2 components — state
store, providers, pollers, handlers, command executor, and runtime adapters — into a sequential
event-processing loop. The engine owns the event queue and processing loop; all other behavior is
delegated to component modules. It exposes a public interface consumed by the TUI for state
subscription, event enqueuing, detail queries, and agent output streams.

## Constraints

- Must not import or reference the TUI module.
- All external mutations must flow through the CommandExecutor — no component bypasses the broker
  boundary.
- Events are processed sequentially — each event is fully processed (state update, handlers, command
  execution) before the next is dequeued.
- The state store is the single source of truth for all domain state. No parallel state systems.
- Provider-specific types must not appear outside the provider module. The engine operates on domain
  types defined in [domain-model.md](./domain-model.md).
- Must not crash on transient errors. Provider-internal retry handles transient failures; the engine
  handles persistent failures via `CommandFailed` events through normal event processing.
- Handlers are pure functions — they never mutate state, call providers, or produce side effects.
- Agent execution produces structured artifacts only. Runtime adapters must not perform external
  writes.

## Specification

### Architecture

```mermaid
flowchart TD
    P[Pollers] -->|domain events| Q[Event Queue]
    RA[Runtime Adapters] -->|agent lifecycle events| Q
    TUI -->|user events| Q

    Q --> Loop[Processing Loop]
    Loop -->|1. update| Store[State Store]
    Loop -->|2. event + snapshot| H[Handlers]
    H -->|3. commands| CE[CommandExecutor]
    CE -->|result events| Q
    CE -->|write| PW[Provider Writers]
    CE -->|start / cancel| RA
    P -.->|read| PR[Provider Readers]
    Store -.->|subscribe| TUI
```

Three categories of components surround the engine core:

- **Event sources** (pollers, runtime adapters, user actions) produce domain events into the queue.
- **External systems** (provider writers, runtime adapters) are reached only through the
  CommandExecutor.
- **Subscribers** (TUI) read engine state via store subscription but do not modify it directly.

### Event Queue

FIFO buffer. `enqueue` appends to the tail; the processing loop dequeues from the head. Commands
executed during event processing may produce new events — these are appended to the queue and
processed after the current event's full cycle completes. Handler logic never interleaves with the
effects of its own commands.

Events enqueued after shutdown begins are rejected (see [Shutdown](#shutdown)).

### Processing Loop

Events are processed sequentially. Each event is fully processed before the next is dequeued.

```
processEvent(engine, event):
  applyStateUpdate(engine.store, event)
  snapshot = engine.store.getState()
  commands = runHandlers(engine.handlers, event, snapshot)
  for command in commands:
    resultEvents = await engine.executor.execute(command, snapshot)
    for resultEvent in resultEvents:
      engine.queue.enqueue(resultEvent)

runHandlers(handlers, event, state):
  commands = []
  for handler in handlers:
    commands.push(...handler(event, state))
  return commands
```

The processing loop passes a single state snapshot to all handlers for a given event. Handlers
cannot observe each other's commands within the same event cycle — all commands are collected first,
then executed in sequence. Commands that produce result events append those events to the queue for
processing in subsequent cycles.

> **Rationale:** Sequential processing with a single snapshot eliminates concurrency hazards. The
> independence invariant (defined in
> [domain-model.md: Domain Commands](./domain-model.md#domain-commands)) ensures commands from one
> cycle cannot depend on effects of other commands in the same cycle.

### Engine Public Interface

```ts
interface Engine {
  store: StoreApi<EngineState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(event: EngineEvent): void;
  getState(): EngineState;
  subscribe(listener: (state: EngineState) => void): Unsubscribe;
  getWorkItemBody(id: string): Promise<string>;
  getRevisionFiles(id: string): Promise<RevisionFile[]>;
  getAgentStream(sessionID: string): AsyncIterable<string> | null;
  refresh(): void;
}

type Unsubscribe = () => void;
```

| Method                      | Description                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`                     | Direct Zustand store reference. The TUI subscribes via `useStore(engine.store, selector)` for React/Ink binding.                                                  |
| `start()`                   | Runs the first poll cycle of all pollers (direct, awaited), begins interval polling, starts the processing loop. Resolves after first poll cycles.                |
| `stop()`                    | Graceful shutdown. See [Shutdown](#shutdown).                                                                                                                     |
| `enqueue(event)`            | Appends a domain event to the queue. Used by pollers, runtime adapter monitors, and the TUI (for user actions).                                                   |
| `getState()`                | Returns the current `EngineState` snapshot from the state store.                                                                                                  |
| `subscribe(listener)`       | Subscribes to state changes via the Zustand store. Returns an unsubscribe function.                                                                               |
| `getWorkItemBody(id)`       | Delegates to `provider.workItemReader.getWorkItemBody(id)`. On-demand detail fetch — the store holds summary data only.                                           |
| `getRevisionFiles(id)`      | Delegates to `provider.revisionReader.getRevisionFiles(id)`. On-demand detail fetch.                                                                              |
| `getAgentStream(sessionID)` | Looks up the `AgentRunHandle` in the private handle map. Returns the `output` stream, or `null` if no handle exists (session ended, invalid, or not yet started). |
| `refresh()`                 | Triggers an immediate poll cycle on all pollers (outside the regular interval).                                                                                   |

The TUI enqueues user actions as domain events (`UserRequestedImplementorRun`, `UserCancelledRun`,
`UserTransitionedStatus`) — it does not dispatch commands directly. User events flow through the
standard pipeline: state update → handlers → command execution, subject to the same concurrency
guards and policy checks as automated dispatch.

### Engine Wiring

`createEngine(config)` assembles all components and returns the `Engine` interface. The engine
receives pre-built provider interfaces as injected dependencies, and a factory function for runtime
adapters. It does not know or care what implementations back the interfaces.

Construction steps (order matters — later steps depend on earlier ones):

1. **Create state store** — `createEngineStore()`.
2. **Create event queue** — `createEventQueue()`.
3. **Create runtime adapters** — call `config.createRuntimeAdapters(deps)` with `getState` from the
   store and provider readers from config.
4. **Create command executor** — `createCommandExecutor(deps)` with provider writers, runtime
   adapters, policy, `getState`, and `enqueue`.
5. **Create handlers** — `createHandlers()`.
6. **Create pollers** — one each for work items, revisions, and specs. Each receives its reader,
   `getState`, `enqueue`, and a poll interval from config (defaults: 30s, 30s, 60s).
7. **Return Engine** — the public interface (store, start, stop, enqueue, getState, subscribe,
   getWorkItemBody, getRevisionFiles, getAgentStream, refresh).

`refresh()` calls `poll()` on each poller directly, outside the interval timer. The pollers enqueue
events as usual — the processing loop handles them in order.

`createEngine` is a synchronous factory. Asynchronous initialization (first poll cycles) happens in
`start()`.

> **Rationale:** Synchronous construction allows the TUI to set up subscriptions before any events
> are processed. The TUI creates the engine, subscribes to the store, then calls `start()`. No race
> between subscription and startup events.

**Read/write enforcement.** Provider readers are passed to pollers; provider writers are passed to
the CommandExecutor. No component receives both a reader and writer for the same entity type. This
is enforced through wiring and TypeScript types — `WorkProviderReader` and `WorkProviderWriter` are
distinct interfaces.

## Poller Lifecycle

All three pollers (work item, revision, spec) share a common lifecycle protocol.

**First-cycle execution.** Pollers execute their first cycle immediately when `start()` is called —
direct invocation, awaited. This ensures the state store is populated with current external state
before interval-based polling begins. See [Startup Sequence](#startup-sequence) for the full startup
ordering.

**Interval-based polling.** After the first cycle completes, pollers begin interval-based polling.
Each poller runs independently on its configured interval (see [Configuration](#configuration) for
defaults).

**Error handling.** Individual item errors within a poll cycle are logged and skipped — they never
abort the batch. If a single entity fails to process (e.g., a malformed API response for one work
item), the poller continues processing the remaining entities in that cycle. Provider-level errors
(e.g., network failure affecting the entire API call) are caught and logged; the poller waits for
the next interval and retries.

### Agent Run Handle Map

The engine maintains a private `Map<string, AgentRunHandle>` keyed by `sessionID`. The
CommandExecutor's `startAgentAsync` function registers handles with the engine when the runtime
adapter returns them. Entries are removed when the run reaches a terminal state (`completed`,
`failed`, `timed-out`, `cancelled`) or on shutdown.

`getAgentStream(sessionID)` looks up the handle and returns its `output` stream. Returns `null` if
no handle exists — the session has ended, the session ID is invalid, or the agent has not yet
started (still in `requested` state, before `startAgent` resolves).

### Startup Sequence

`start()` performs the following steps in order:

1. Run the first poll cycle of all three pollers (direct invocation, awaited). This populates the
   state store with current external state.
2. Begin interval-based polling for all pollers.
3. Start the processing loop (draining the event queue).

`start()` resolves after step 1 completes. The TUI can begin rendering immediately — all
current-state entities are in the store.

> **Rationale:** The first poll cycle is awaited so the store is populated before the TUI renders.
> Events from the initial poll drive recovery naturally — work items in `in-progress` with no active
> agent run are transitioned to `pending` through normal event processing. No separate bootstrap or
> recovery phase is needed.

### Shutdown

`stop()` performs the following steps in order:

1. Mark the engine as shutting down — `enqueue` rejects new events after this point (except terminal
   events from agent monitors in step 3).
2. Cancel all active agent runs (via `runtimeAdapter.cancelAgent`).
3. Wait for async agent monitors to drain their terminal events, up to `shutdownTimeout` seconds. If
   timeout is reached, abandon remaining monitors.
4. Stop all pollers (no new cycles).
5. Drain the event queue (process remaining events, which include terminal events from step 3).
6. Stop the processing loop.

> **Rationale:** New events are rejected after step 1 to prevent heisenbugs where external sources
> enqueue events into a draining queue. Agent monitors are exempted so their terminal events can be
> processed during the drain phase. Cancelling runs (step 2) before stopping pollers (step 4)
> ensures agent processes are terminated before the engine becomes unresponsive.

### Configuration

```ts
interface EngineConfig {
  // Injected components — engine operates on interfaces, not implementations
  provider: {
    workItemReader: WorkProviderReader;
    workItemWriter: WorkProviderWriter;
    revisionReader: RevisionProviderReader;
    revisionWriter: RevisionProviderWriter;
    specReader: SpecProviderReader;
  };
  createRuntimeAdapters: (deps: RuntimeAdapterDeps) => Record<AgentRole, RuntimeAdapter>;
  policy?: Policy; // default: allow all commands

  // Engine-owned config
  logLevel?: "debug" | "info" | "error"; // default: 'info'
  shutdownTimeout?: number; // seconds, default: 300
  logging?: {
    agentSessions?: boolean; // default: false — enable per-session log files
    logsDir?: string; // default: './logs' — directory for agent session log files
  };
  workItemPoller?: {
    pollInterval?: number; // seconds, default: 30
  };
  revisionPoller?: {
    pollInterval?: number; // seconds, default: 30
  };
  specPoller?: {
    pollInterval?: number; // seconds, default: 60
  };
}
```

The engine's configuration contains only engine-owned concerns: polling intervals, shutdown timeout,
and log level. All implementation-specific configuration — GitHub credentials, repository path,
runtime adapter settings, agent names, logging directories — belongs in the config file
(`control-plane.config.ts`), which constructs providers and adapter factories and passes them as
pre-built interfaces. See [control-plane.md: Configuration](./control-plane.md#configuration) for
the config file contract.

`provider` carries five interfaces that the engine threads to pollers (readers) and the
CommandExecutor (writers). `createRuntimeAdapters` is a factory function that receives
`RuntimeAdapterDeps` (defined in
[control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md)) and returns
per-role adapters. The engine calls this factory during construction, after the state store exists,
providing `getState`, provider readers, and `getReviewHistory`. The config file's factory closure
captures adapter-specific config (e.g. `ClaudeAdapterConfig`). Both `provider` and
`createRuntimeAdapters` are required — the engine cannot operate without them.

`policy` is optional — when omitted, the engine uses a default policy that allows all commands.

Config validation is performed at construction time — missing required fields or invalid values
cause the engine to throw.

### Component Cross-References

Each component's behavior, interfaces, type definitions, and acceptance criteria are defined in its
dedicated spec. The engine spec defines only how components are wired together.

| Component        | Spec                                                                                   | Engine wiring role                                                     |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| State Store      | [control-plane-engine-state-store.md](./control-plane-engine-state-store.md)           | `createEngineStore()` — loop calls `applyStateUpdate` and `getState`   |
| WorkItem Poller  | [control-plane-engine-work-item-poller.md](./control-plane-engine-work-item-poller.md) | `createWorkItemPoller(config)` — enqueues `WorkItemChanged` events     |
| Revision Poller  | [control-plane-engine-revision-poller.md](./control-plane-engine-revision-poller.md)   | `createRevisionPoller(config)` — enqueues `RevisionChanged` events     |
| Spec Poller      | [control-plane-engine-spec-poller.md](./control-plane-engine-spec-poller.md)           | `createSpecPoller(config)` — enqueues `SpecChanged` events             |
| Handlers         | [control-plane-engine-handlers.md](./control-plane-engine-handlers.md)                 | `createHandlers()` — loop passes events and state snapshots            |
| Command Executor | [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) | `createCommandExecutor(deps)` — loop executes handler-emitted commands |
| Runtime Adapter  | [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md)   | Core contract — `RuntimeAdapter` interface and `AgentRunHandle`        |

### Logging

The engine logs structured events at `info`, `debug`, and `error` levels covering startup, shutdown,
processing loop events, agent dispatch/completion/failure, poller cycles, and provider errors. See
[Agent Session Logging: Log Format](./control-plane-engine-agent-session-logging.md#log-file-format)
for per-event logging behavior of agent sessions.

### Error Handling

Error handling follows the architecture defined in
[CommandExecutor: Error Handling](./control-plane-engine-command-executor.md#error-handling). The
engine does not retry failed commands. Recovery from persistent failures is handled through the
normal event pipeline — handlers reacting to state changes (e.g. detecting in-progress work items
with no active run and transitioning them to `pending`). See
[Handlers: handleOrphanedWorkItem](./control-plane-engine-handlers.md#handleorphanedworkitem).

### Type Definitions

Domain types (`EngineEvent`, `EngineCommand`, `WorkItem`, `Revision`, `Spec`, `AgentResult`,
`AgentStartParams`) are defined in [domain-model.md](./domain-model.md). Component types are defined
in their respective component specs.

The engine spec owns `EngineConfig` (see [Configuration](#configuration)) and `Engine` (see
[Engine Public Interface](#engine-public-interface)). The `Policy` type is defined in the
[CommandExecutor spec](./control-plane-engine-command-executor.md).

**Module location:** `engine/create-engine.ts` — the engine factory. Internal helpers
(`createEventQueue`, `buildReviewHistoryFetcher`) live alongside or under the engine module.
`buildReviewHistoryFetcher` is a thin delegation to `RevisionProviderReader.getReviewHistory` — it
binds the reader method to satisfy the `RuntimeAdapterDeps.getReviewHistory` signature.

## Acceptance Criteria

### Processing Loop

- [ ] Given two events in the queue, when the processing loop runs, then the first event is fully
      processed (state update, handlers, command execution) before the second event is dequeued.
- [ ] Given a command produces result events during execution, when those events are enqueued, then
      they are processed in subsequent cycles — not within the current event's cycle.
- [ ] Given handlers emit multiple commands for a single event, when the commands are executed, then
      they all receive the same state snapshot (captured once after the state update, not re-read
      between command executions).
- [ ] Given a `UserRequestedImplementorRun` event is enqueued, when it is processed, then it flows
      through the full pipeline (state update → handlers → commands) including concurrency guards
      and policy checks.

### Startup

- [ ] Given `start()` is called, when it resolves, then all three pollers have completed their first
      cycle and the state store contains all detected entities.
- [ ] Given the store is empty at startup and the first poll detects a work item in `in-progress`
      with no active agent run, when the `WorkItemChanged` event is processed, then it is
      transitioned to `pending` through normal event processing — no separate recovery phase.
- [ ] Given `start()` resolves, when the TUI queries `getState()`, then the store reflects the
      current external state (not empty).

### Shutdown

- [ ] Given `stop()` is called while agent runs are active, when shutdown proceeds, then all active
      runs are cancelled before pollers are stopped.
- [ ] Given `stop()` is called and `shutdownTimeout` is reached before monitors drain, when the
      timeout fires, then remaining monitors are abandoned and the processing loop terminates.
- [ ] Given the engine is shutting down (after `stop()` marks the engine), when `enqueue` is called
      with a new event, then the event is rejected.
- [ ] Given active agent runs exist at shutdown, when their monitors produce terminal events within
      the timeout, then those events are processed normally (draining the queue) before the loop
      stops.

### Agent Run Handles

- [ ] Given an agent run starts successfully (runtime adapter returns a handle), when the handle is
      registered, then `getAgentStream(sessionID)` returns the handle's `output` stream.
- [ ] Given an agent run reaches a terminal state, when the handle is cleaned up, then
      `getAgentStream(sessionID)` returns `null`.
- [ ] Given `getAgentStream` is called for a session in `requested` state (before `startAgent`
      resolves), when the handle does not yet exist, then it returns `null`.

### Wiring

- [ ] Given the engine is created, when component dependencies are inspected, then provider readers
      are passed to pollers and provider writers are passed to the CommandExecutor — no component
      receives both a reader and writer for the same entity type.
- [ ] Given the engine is created, when `engine.store` is accessed, then it returns the Zustand
      store instance for `useStore` binding.
- [ ] Given `getWorkItemBody` is called, when it executes, then it delegates to
      `provider.workItemReader.getWorkItemBody` without caching.
- [ ] Given `getRevisionFiles` is called, when it executes, then it delegates to
      `provider.revisionReader.getRevisionFiles` without caching.

### Configuration

- [ ] Given `createEngine` is called with `config.provider` missing any of the five interfaces, when
      validation runs, then it throws.
- [ ] Given `createEngine` is called without `createRuntimeAdapters`, when validation runs, then it
      throws.
- [ ] Given `createEngine` is called with a valid `createRuntimeAdapters` factory, when the engine
      constructs, then the factory receives `RuntimeAdapterDeps` containing `getState` from the
      engine's store and provider readers from `config.provider`.
- [ ] Given `createEngine` is called with injected provider interfaces, when pollers and the
      CommandExecutor are created, then readers are threaded to pollers and writers are threaded to
      the CommandExecutor.
- [ ] Given `createEngine` is called with no `policy`, when the engine initializes, then it uses a
      default policy that allows all commands.
- [ ] Given `refresh()` is called, when it executes, then all three pollers perform an immediate
      poll cycle outside their regular interval.

## Dependencies

- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) —
  `createEngineStore`, `applyStateUpdate`, selectors.
- [control-plane-engine-work-item-poller.md](./control-plane-engine-work-item-poller.md) —
  `createWorkItemPoller`, work item change detection.
- [control-plane-engine-revision-poller.md](./control-plane-engine-revision-poller.md) —
  `createRevisionPoller`, revision and pipeline change detection.
- [control-plane-engine-spec-poller.md](./control-plane-engine-spec-poller.md) — `createSpecPoller`,
  spec file change detection.
- [control-plane-engine-handlers.md](./control-plane-engine-handlers.md) — `createHandlers`, seven
  handler functions.
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) —
  `createCommandExecutor`, broker boundary, `Policy` type.
- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) —
  `RuntimeAdapter` interface, `AgentRunHandle`, `AgentStartParams`, `RuntimeAdapterDeps`.
- [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md) —
  Agent session logging (log file path on terminal events).
- [domain-model.md](./domain-model.md) — Domain model, event/command unions, agent role contracts.
- [workflow.md](./workflow.md) — Status transition table, quality gates.

## References

- [domain-model.md](./domain-model.md) — Domain model, component contracts.
- [control-plane-tui.md](./control-plane-tui.md) — TUI specification (consumes the engine's public
  interface).
- [agent-planner.md](./agent-planner.md) — Planner agent definition.
- [agent-implementor.md](./agent-implementor.md) — Implementor agent definition.
- [agent-reviewer.md](./agent-reviewer.md) — Reviewer agent definition.
