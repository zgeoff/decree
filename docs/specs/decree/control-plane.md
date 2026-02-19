---
title: Agentic Workflow Control Plane
version: 1.0.0
last_updated: 2026-02-19
status: approved
---

# Agentic Workflow Control Plane

## Overview

The control plane is an interactive, long-running TUI application that operates the development
workflow defined in `workflow.md`. It monitors work items, revisions, and spec files for state
changes via provider interfaces, dispatches agents through handler-based workflow logic, and
provides a dashboard for observing and acting on development tasks.

It is the single interface through which the Human role interacts with the automated workflow —
observing state, dispatching agents, and responding to notifications.

## Constraints

- Must be manually started. Does not auto-start or run as a system service.
- Must remain interactive while agents run. The user can observe, dispatch, and respond at any time.
- Must not invoke agents concurrently for the same work item. One agent per work item at a time.
- Must auto-recover orphaned `in-progress` work items when no agent is running for them (transition
  to `pending`).
- Must only auto-dispatch the Planner for specs with `status: approved` in frontmatter.
- All external mutations must flow through the CommandExecutor — no component bypasses this
  boundary.
- The engine must operate on normalized domain types only — no provider-specific types leak past
  provider boundaries.
- Agents must produce structured artifacts only — they must not perform external writes (no GitHub
  operations, no branch pushing, no status changes).
- The config file (`control-plane.config.ts`) must default-export an `EngineConfig` with pre-built
  provider interfaces and a runtime adapter factory. The entry point (`main.ts`) must not contain
  provider construction, credential handling, or adapter wiring.

## Specification

### Architecture

The control plane consists of two co-located modules in a single process:

- **Engine** — Event processing, state management, handler-based dispatch, agent lifecycle, and
  provider integration. Owns all workflow state. Has no knowledge of the TUI.
- **TUI** — Ink-based (React for terminal) dashboard that renders engine state and captures user
  input. Consumes the engine; never imported by it.

Both modules live in the `@decree/control-plane` workspace package at `packages/control-plane/` in
the repository root. They are separate modules with explicit exports, not separate packages.

### Component Architecture

See [Domain Model: Component Architecture](./domain-model.md#component-architecture) for the system
component diagram and component category descriptions.

See [control-plane-engine.md: Engine Wiring](./control-plane-engine.md#engine-wiring) for the full
`createEngine(config)` assembly.

### Engine Public Interface

The engine exposes a store-based interface consumed by the TUI:

| Method                      | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `store`                     | Zustand vanilla store — TUI subscribes via selectors |
| `start()`                   | Start pollers, begin processing                      |
| `stop()`                    | Cancel active runs, drain queue, shut down           |
| `enqueue(event)`            | Add domain event to queue                            |
| `getState()`                | Current state snapshot                               |
| `subscribe(listener)`       | State change subscription                            |
| `getWorkItemBody(id)`       | On-demand work item detail (delegates to provider)   |
| `getRevisionFiles(id)`      | On-demand revision detail (delegates to provider)    |
| `getAgentStream(sessionID)` | Live agent output stream for TUI display             |
| `refresh()`                 | Trigger immediate poll cycle                         |

The TUI subscribes to the engine's Zustand store via `useStore(engine.store, selector)`. User
actions produce domain events enqueued via `engine.enqueue()` — the TUI never sends commands
directly. The entry point calls `renderApp()` to mount the TUI — see
[control-plane-tui.md](./control-plane-tui.md) for the `renderApp` interface and TUI specification.

See [control-plane-engine.md](./control-plane-engine.md) for the full engine specification.

### Data Flow

Events are processed sequentially. Each event is fully processed before the next is dequeued:

1. **State update** — `applyStateUpdate` applies the event to the store.
2. **Handler evaluation** — All handlers receive the event and a post-update state snapshot,
   returning domain commands.
3. **Command execution** — The CommandExecutor processes each command, producing result events that
   are appended to the queue for subsequent processing.

Commands emitted by handlers in a single event cycle must be independent — no command may depend on
the effects of another command in the same cycle. Dependent operations are expressed as compound
commands (`ApplyPlannerResult`, `ApplyImplementorResult`, `ApplyReviewerResult`) that the
CommandExecutor executes as a single sequenced unit (no interleaving with other command executions,
but no rollback on partial failure).

See [control-plane-engine.md: Processing Loop](./control-plane-engine.md#processing-loop) for
pseudocode and ordering guarantees.

### Handler-Based Dispatch

Workflow logic is organized as handler functions — pure functions with the shape
`(event, state) → commands[]`. Handlers receive a read-only state snapshot and return domain
commands. They never mutate state, call providers, or produce side effects.

| Handler                      | Trigger summary                                                             | Response summary                                                     |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `handlePlanning`             | Approved spec changed (`blobSHA` differs from `lastPlannedSHAs`)            | Request planner run; apply planner results on completion             |
| `handleReadiness`            | Work item enters `pending`                                                  | Promote to `ready` when all `blockedBy` items are in terminal status |
| `handleImplementation`       | Work item enters `ready`; implementor completes                             | Request implementor run; apply result on completion                  |
| `handleReview`               | Revision pipeline succeeds; reviewer completes                              | Request reviewer run; apply result on completion                     |
| `handleDependencyResolution` | Work item reaches terminal status (`closed`, `approved`)                    | Promote pending dependents whose blockers are all resolved           |
| `handleOrphanedWorkItem`     | Work item `in-progress` with no active agent run                            | Transition to `pending` (crash recovery)                             |
| `handleUserDispatch`         | `UserRequestedImplementorRun`, `UserCancelledRun`, `UserTransitionedStatus` | Translate user events into domain commands                           |

Handler order does not affect correctness — all commands are collected before execution, and
handlers cannot observe each other's commands within the same event cycle.

See [control-plane-engine-handlers.md](./control-plane-engine-handlers.md) for full handler
specifications, guard conditions, and event coverage.

### Provider Abstraction

The engine operates on three domain types (`WorkItem`, `Revision`, `Spec`) through five provider
interfaces — three readers and two writers:

| Interface                | Direction | Consumer        |
| ------------------------ | --------- | --------------- |
| `WorkProviderReader`     | Read      | WorkItem poller |
| `WorkProviderWriter`     | Write     | CommandExecutor |
| `RevisionProviderReader` | Read      | Revision poller |
| `RevisionProviderWriter` | Write     | CommandExecutor |
| `SpecProviderReader`     | Read      | Spec poller     |

**Read/write enforcement.** The engine setup function threads each interface to the component that
needs it — readers go to pollers, writers go to the CommandExecutor. TypeScript types enforce the
separation at compile time.

**GitHub implementation.** A single `createGitHubProvider(config)` factory returns all five
interfaces. It normalizes GitHub API types (issues, PRs, tree entries) into domain types at the
boundary. No GitHub-specific types leak past the provider.

See [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) for the
full provider specification, domain type mapping, and retry strategy.

### Broker Boundary

The CommandExecutor is the single path for all external mutations — the "broker" between domain
commands and provider operations. It receives domain commands from handlers, validates them,
translates them into provider calls, and emits result events.

The execution pipeline has three stages:

1. **Concurrency guards** — One planner at a time (global). One agent per work item. Rejected
   commands produce `CommandRejected` events.
2. **Policy gate** — An injected `Policy` function that returns `allowed` or a rejection reason.
   Policy does not modify commands.
3. **Translation and execution** — Domain commands are translated into provider writer calls or
   runtime adapter invocations. Provider failures produce `CommandFailed` events.

Agent request commands produce an immediate `*Requested` event and kick off an async lifecycle
manager that enqueues `*Started`, `*Completed`, or `*Failed` events as the agent progresses.

See [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) for the
full command translation table, compound command execution, and error semantics.

### Runtime Adapter

Agent execution is mediated by a `RuntimeAdapter` interface — the engine programs against this
contract, and the runtime implementation is pluggable per role. Agents produce structured output
only; all external mutations are performed by the CommandExecutor after processing agent results.

See [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) for the
`RuntimeAdapter` and `AgentRunHandle` interface definitions, and
[control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
for the Claude SDK implementation (worktree management, context assembly, structured output
validation).

### Recovery

Recovery flows through the normal event pipeline — there is no separate recovery module or bootstrap
phase.

When the engine restarts after a crash, pollers run their initial poll immediately, populating the
state store with current external state. Work items detected as `in-progress` with no active agent
run trigger `handleOrphanedWorkItem`, which transitions them to `pending`. The `handleReadiness`
handler then promotes eligible items to `ready`, re-entering normal dispatch.

See
[control-plane-engine-handlers.md: handleOrphanedWorkItem](./control-plane-engine-handlers.md#handleorphanedworkitem)
for the recovery handler specification.

### Configuration

The application is configured via `control-plane.config.ts` at the package root. This file
default-exports an `EngineConfig` — the engine's dependency-injection contract defined in
[control-plane-engine.md: Configuration](./control-plane-engine.md#configuration). The config file
is the user's integration point: it constructs provider interfaces, runtime adapter factories, and
optional policy, then passes them as pre-built implementations. Top-level `await` is permitted for
async provider construction (e.g. `createGitHubProvider`).

```
// control-plane.config.ts (pseudocode)
provider   = await createGitHubProvider({ appID, privateKey, ... })
adapter    = (deps) => createClaudeAdapter(adapterConfig, deps)

export default {
  repository,
  provider,
  createRuntimeAdapters: (deps) => {
    a = adapter(deps)
    return { planner: a, implementor: a, reviewer: a }
  },
  logLevel,
  shutdownTimeout,
  workItemPoller:   { pollInterval },
  revisionPoller:   { pollInterval },
  specPoller:       { pollInterval },
}
```

The entry point (`main.ts`) is a thin loader: load config → `createEngine(config)` → `renderApp()` →
await exit. Provider construction, credential handling, and adapter wiring reside in the config file
— never in the entry point.

> **Rationale:** Users swap providers and runtime adapters by editing the config file — not by
> modifying engine internals or the entry point. A Jira provider or an OpenAI adapter is a config
> change. The engine operates on interfaces; the config file is where implementations are chosen.

### Technology

| Choice           | Detail                                               |
| ---------------- | ---------------------------------------------------- |
| Language         | TypeScript                                           |
| Execution        | `tsx` (no build step)                                |
| Package          | `@decree/control-plane` at `packages/control-plane/` |
| Run command      | `yarn control-plane`                                 |
| TUI framework    | Ink (React for terminal)                             |
| State management | Zustand (vanilla store + React binding)              |
| GitHub API       | `@octokit/rest` with `@octokit/auth-app`             |
| Agent invocation | `@anthropic-ai/claude-agent-sdk`                     |
| Configuration    | TypeScript config file (`control-plane.config.ts`)   |

> **Rationale:** GitHub API and agent SDK libraries are isolated behind provider and runtime adapter
> boundaries respectively. They are not imported outside their boundary modules.

### Testing Strategy

See [Control Plane Testing](./control-plane-testing.md) for the test utility catalog, mock
factories, and component testing patterns.

## Acceptance Criteria

- [ ] Given the control plane is started, when startup completes, then the first poll cycle
      completes before the TUI receives its first state update — ensuring the store is populated
      before rendering.
- [ ] Given a user presses the dispatch key in the TUI, when the event reaches `handleUserDispatch`,
      then it flows through the same concurrency guards and policy checks as automated dispatch.
- [ ] Given a work item is `in-progress` with no active agent run after a crash, when the engine
      restarts and the first poll completes, then `handleOrphanedWorkItem` transitions it to
      `pending` through normal event processing — no dedicated recovery phase.
- [ ] Given a handler emits a `RequestImplementorRun` command for a work item that already has an
      active agent, when the CommandExecutor checks concurrency guards, then the command is rejected
      with a `CommandRejected` event — not silently dropped.
- [ ] Given a planner completes and its result includes work items with `tempID` references in
      `blockedBy`, when the CommandExecutor processes `ApplyPlannerResult`, then creates are
      processed in order, `tempID` values are resolved to real work item IDs, and `blockedBy`
      references on subsequently created items use the resolved IDs.
- [ ] Given a work item with unresolved `blockedBy` dependencies enters `pending`, when
      `handleReadiness` evaluates it, then it remains `pending` until all blockers reach terminal
      status — `handleDependencyResolution` promotes it when the last blocker completes.
- [ ] Given the config file uses top-level `await` for async provider construction, when the entry
      point loads the config, then it awaits the module evaluation before passing interfaces to the
      engine — no unresolved promises leak into `EngineConfig`.
- [ ] Given a config file that provides provider interfaces backed by a non-GitHub implementation,
      when the engine starts, then polling, event processing, and command execution operate normally
      — no engine or entry point changes are required.
- [ ] Given two handlers that both emit commands for the same event, when the commands are
      collected, then each handler receives the same pre-update state snapshot regardless of handler
      execution order.

## Known Limitations

Cross-spec index of intentional capability gaps. Each limitation is described in the referenced
spec's own Known Limitations section.

| Limitation                                                             | Spec                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pagination capped at 100 items per call (work items, revisions, files) | [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md)               |
| SpecPoller commit SHA is HEAD, not per-file                            | [control-plane-engine-spec-poller.md](./control-plane-engine-spec-poller.md)                       |
| `settingSources: []` SDK workaround (worktree `.git` file issue)       | [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md) |
| Run cancellation and manual status transitions not surfaced in TUI     | [control-plane-tui.md](./control-plane-tui.md)                                                     |

## Dependencies

- [control-plane-engine.md](./control-plane-engine.md) — Engine specification (event processing,
  component wiring, public interface)
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — State store
  (canonical state shape, selectors, update functions)
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) — Provider
  interfaces and GitHub implementation
- [control-plane-engine-work-item-poller.md](./control-plane-engine-work-item-poller.md) — WorkItem
  poller
- [control-plane-engine-revision-poller.md](./control-plane-engine-revision-poller.md) — Revision
  poller
- [control-plane-engine-spec-poller.md](./control-plane-engine-spec-poller.md) — Spec poller
- [control-plane-engine-handlers.md](./control-plane-engine-handlers.md) — Handler catalog (dispatch
  logic, recovery, dependency resolution)
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) — Command
  execution (broker boundary, concurrency guards, policy gate)
- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) — Runtime
  adapter core contract
- [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
  — Claude SDK adapter implementation
- [control-plane-testing.md](./control-plane-testing.md) — Test utility catalog, mock factories, and
  component testing patterns
- [control-plane-tui.md](./control-plane-tui.md) — TUI specification (layout, interactions,
  rendering)
- [workflow.md](./workflow.md) — Development workflow definition (roles, phases, status transitions)
- [workflow-contracts.md](./workflow-contracts.md) — Shared data formats and templates
- [agent-planner.md](./agent-planner.md) — Planner agent behavior
- [agent-implementor.md](./agent-implementor.md) — Implementor agent behavior
- [agent-reviewer.md](./agent-reviewer.md) — Reviewer agent behavior

## References

- `docs/specs/decree/domain-model.md` — Domain model (types, events, commands, agent results)
