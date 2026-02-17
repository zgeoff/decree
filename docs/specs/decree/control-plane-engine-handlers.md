---
title: Control Plane Engine — Handlers
version: 0.1.0
last_updated: 2026-02-17
status: approved
---

# Control Plane Engine — Handlers

## Overview

Handlers are pure functions that implement the engine's workflow logic. Each handler reacts to
domain events and produces domain commands. They are the decision layer — sitting between state
updates and command execution in the processing loop. Handlers never mutate state, call providers,
or produce side effects.

## Constraints

- Handlers are pure functions: `(event: EngineEvent, state: EngineState) → EngineCommand[]`.
- Handlers must not mutate state, call providers, enqueue events, or produce side effects.
- An empty array return means no action for this event.
- Handlers receive a read-only state snapshot — the snapshot reflects the state _after_
  `applyStateUpdate` has been applied for the current event.
- Commands emitted in a single event cycle must be independent (see
  [Independence Invariant](#independence-invariant)).
- Handler ordering does not affect correctness — the same set of commands is produced regardless of
  the order handlers are called.

## Specification

### Handler Shape

```ts
type Handler = (event: EngineEvent, state: EngineState) => EngineCommand[];
```

The processing loop calls every handler for every event. Handlers that do not care about an event
return `[]`.

### Wiring

Handlers are wired explicitly in a setup function — no dynamic registry, no plugin framework:

```ts
function createHandlers(): Handler[] {
  return [
    handlePlanning,
    handleReadiness,
    handleImplementation,
    handleReview,
    handleDependencyResolution,
    handleOrphanedWorkItem,
    handleUserDispatch,
  ];
}
```

### Handler Catalog

#### handlePlanning

Drives the planning workflow — dispatching planner runs when approved specs change and applying
planner results when runs complete.

**Triggers and actions:**

| Event              | Guard condition                 | Commands emitted                                     |
| ------------------ | ------------------------------- | ---------------------------------------------------- |
| `SpecChanged`      | Approved spec requires planning | `RequestPlannerRun`                                  |
| `PlannerCompleted` | _(always)_                      | `ApplyPlannerResult`; optionally `RequestPlannerRun` |

**`SpecChanged` behavior:**

1. If `event.frontmatterStatus` is not `'approved'`, return `[]`.
2. If `getSpecsRequiringPlanning(state)` is empty, return `[]`.
3. Collect all spec paths with `frontmatterStatus: 'approved'` from `state.specs`.
4. Emit `RequestPlannerRun { specPaths }`.

> **Rationale:** The planner receives all approved spec paths for full context — not just the
> changed ones. The trigger condition ensures the handler only fires when at least one spec has
> changed since it was last planned. The planner needs the full approved-spec corpus to make
> holistic decisions about which work items to create, close, or update.

**`PlannerCompleted` behavior:**

1. Emit `ApplyPlannerResult { result: event.result }`.
2. Check `getSpecsRequiringPlanning(state)`. If non-empty (specs changed while the planner was
   running), collect all approved spec paths and emit `RequestPlannerRun { specPaths }`.

> **Rationale:** Re-checking on completion catches specs that changed during the planner run. Since
> `applyPlannerCompleted` has already updated `lastPlannedSHAs` before handlers run,
> `getSpecsRequiringPlanning` correctly reflects only newly-changed specs.

**Events with no handler action:**

- `PlannerRequested` — state update creates the run; no handler action needed.
- `PlannerStarted` — state update transitions the run; no handler action needed.
- `PlannerFailed` — `lastPlannedSHAs` is not updated by the state update (by design). The next poll
  cycle re-detects approved specs and emits `SpecChanged` events that re-trigger this handler.

#### handleReadiness

Promotes newly-pending work items to `ready` when they have no unresolved dependencies.

**Triggers and actions:**

| Event             | Guard condition                                                            | Commands emitted                  |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------- |
| `WorkItemChanged` | `newStatus === 'pending'` and `isWorkItemUnblocked(state, event.workItem)` | `TransitionWorkItemStatus(ready)` |

**Behavior:**

1. If `event.newStatus` is not `'pending'`, return `[]`.
2. If `isWorkItemUnblocked(state, event.workItem)` is `false`, return `[]`.
3. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: 'ready' }`.

> **Rationale:** `pending` and `ready` are distinct states. Work items are created in `pending` and
> must pass a readiness check before entering the dispatch pool. Recovery always transitions to
> `pending`, forcing a readiness check before re-dispatch. This handler is the single gate between
> `pending` and `ready`.

#### handleImplementation

Drives the implementation workflow — dispatching implementor runs for ready work items, managing
lifecycle transitions, and applying results.

**Triggers and actions:**

| Event                  | Guard condition         | Commands emitted                        |
| ---------------------- | ----------------------- | --------------------------------------- |
| `WorkItemChanged`      | `newStatus === 'ready'` | `RequestImplementorRun`                 |
| `ImplementorRequested` | _(always)_              | `TransitionWorkItemStatus(in-progress)` |
| `ImplementorCompleted` | _(always)_              | `ApplyImplementorResult`                |
| `ImplementorFailed`    | _(always)_              | `TransitionWorkItemStatus(pending)`     |

**`WorkItemChanged` behavior:**

1. If `event.newStatus` is not `'ready'`, return `[]`.
2. Emit `RequestImplementorRun { workItemID: event.workItemID }`.

> **Rationale:** The handler emits intent unconditionally for `ready` work items. The
> CommandExecutor's concurrency guard rejects the command if an agent is already running for the
> work item.

**`ImplementorRequested` behavior:**

1. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: 'in-progress' }`.

> **Rationale:** Status transitions are reactive — the work item remains in `ready` until the
> `ImplementorRequested` event confirms the run was accepted. This prevents status drift when
> commands are rejected by concurrency guards or policy.

**`ImplementorCompleted` behavior:**

1. Emit `ApplyImplementorResult { workItemID: event.workItemID, result: event.result }`.

The `ApplyImplementorResult` compound command encapsulates outcome-dependent operations. See
[control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) for
translation:

- `completed` → create revision from patch, transition to `review`
- `blocked` → transition to `blocked`
- `validation-failure` → transition to `needs-refinement`

**`ImplementorFailed` behavior:**

1. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: 'pending' }`.

> **Rationale:** Transitioning to `pending` (not `ready`) forces a readiness check via
> `handleReadiness`, which verifies the work item's dependencies before re-entering the dispatch
> pool.

**Events with no handler action:**

- `ImplementorStarted` — state update transitions the run to `running`; no work item status change
  needed (already `in-progress`).

#### handleReview

Drives the review workflow — dispatching reviewer runs when CI passes on revisions linked to work
items in review, and applying results.

**Triggers and actions:**

| Event               | Guard condition                                                                  | Commands emitted                    |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| `RevisionChanged`   | `newPipelineStatus === 'success'` and linked work item has `status === 'review'` | `RequestReviewerRun`                |
| `ReviewerCompleted` | _(always)_                                                                       | `ApplyReviewerResult`               |
| `ReviewerFailed`    | _(always)_                                                                       | `TransitionWorkItemStatus(pending)` |

**`RevisionChanged` behavior:**

1. If `event.newPipelineStatus` is not `'success'`, return `[]`.
2. If `event.workItemID` is `null`, return `[]`.
3. Look up the work item in `state.workItems` by `event.workItemID`. If not found or `status` is not
   `'review'`, return `[]`.
4. Emit `RequestReviewerRun { workItemID: event.workItemID, revisionID: event.revisionID }`.

> **Rationale:** The work item status check prevents dispatching reviews for already-approved or
> needs-refinement work items. Revisions without a linked work item are ignored — the engine only
> reviews revisions associated with tracked work.

**`ReviewerCompleted` behavior:**

1. Emit
   `ApplyReviewerResult { workItemID: event.workItemID, revisionID: event.revisionID, result: event.result }`.

The `ApplyReviewerResult` compound command posts (or updates) the review and transitions the work
item based on the verdict. See
[control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) for
translation:

- `approve` → transition to `approved`
- `needs-changes` → transition to `needs-refinement`

**`ReviewerFailed` behavior:**

1. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: 'pending' }`.

> **Rationale:** Same recovery pattern as `ImplementorFailed` — return to `pending` and re-enter the
> readiness check.

**Events with no handler action:**

- `ReviewerRequested` — no work item status change needed (already in `review`).
- `ReviewerStarted` — no status change needed.

#### handleDependencyResolution

Promotes pending work items when their blocking dependencies resolve.

**Triggers and actions:**

| Event             | Guard condition                           | Commands emitted                                           |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `WorkItemChanged` | `newStatus` is `'closed'` or `'approved'` | `TransitionWorkItemStatus(ready)` for unblocked dependents |

**Behavior:**

1. If `event.newStatus` is not `'closed'` and not `'approved'`, return `[]`.
2. Call `getWorkItemsDependingOn(state, event.workItemID)` to find all work items that include the
   completed item in their `blockedBy` list.
3. For each dependent work item: a. If `dependent.status` is not `'pending'`, skip. b. If
   `isWorkItemUnblocked(state, dependent)` is `false`, skip. c. Emit
   `TransitionWorkItemStatus { workItemID: dependent.id, newStatus: 'ready' }`.
4. Return all collected commands.

> **Rationale:** This handler complements `handleReadiness`. While `handleReadiness` promotes
> newly-pending items with no blockers, `handleDependencyResolution` promotes already-pending items
> when their last blocker resolves. Only `pending` items are eligible — work items in `blocked`
> status (set by the implementor for runtime blocking reasons) are not automatically promoted.

#### handleOrphanedWorkItem

Detects work items stuck in `in-progress` with no active agent run and recovers them.

**Triggers and actions:**

| Event             | Guard condition                                                                                   | Commands emitted                    |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `WorkItemChanged` | `newStatus === 'in-progress'` and `isAgentRunningForWorkItem(state, event.workItemID)` is `false` | `TransitionWorkItemStatus(pending)` |

**Behavior:**

1. If `event.newStatus` is not `'in-progress'`, return `[]`.
2. If `isAgentRunningForWorkItem(state, event.workItemID)` is `true`, return `[]`.
3. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: 'pending' }`.

> **Rationale:** This handler covers crash recovery. After an engine restart, the store is empty.
> Pollers detect work items in `in-progress` status from the provider. Since no agent runs exist in
> the fresh store, the handler transitions them to `pending`, which feeds into `handleReadiness` for
> re-dispatch. During normal operation, this handler is a no-op for `in-progress` work items that
> have active runs.

#### handleUserDispatch

Translates user action events into domain commands.

**Triggers and actions:**

| Event                         | Guard condition | Commands emitted                                                   |
| ----------------------------- | --------------- | ------------------------------------------------------------------ |
| `UserRequestedImplementorRun` | _(always)_      | `RequestImplementorRun`                                            |
| `UserCancelledRun`            | _(always)_      | `CancelPlannerRun`, `CancelImplementorRun`, or `CancelReviewerRun` |
| `UserTransitionedStatus`      | _(always)_      | `TransitionWorkItemStatus`                                         |

**`UserRequestedImplementorRun` behavior:**

1. Emit `RequestImplementorRun { workItemID: event.workItemID }`.

**`UserCancelledRun` behavior:**

1. Look up the agent run in `state.agentRuns` by `event.sessionID`.
2. If not found, return `[]`.
3. Based on the run's `role`:
   - `'planner'` → emit `CancelPlannerRun {}`.
   - `'implementor'` → emit `CancelImplementorRun { workItemID: run.workItemID }`.
   - `'reviewer'` → emit `CancelReviewerRun { workItemID: run.workItemID }`.

**`UserTransitionedStatus` behavior:**

1. Emit `TransitionWorkItemStatus { workItemID: event.workItemID, newStatus: event.newStatus }`.

> **Rationale:** User actions flow through the same pipeline as automated dispatch — they are
> subject to the same concurrency guards and policy checks. The handler is a thin translation layer.

### Event Coverage

Every `EngineEvent` type is handled by at least one handler or explicitly has no handler action.
Events with no handler action are processed entirely by state updates.

| Event                         | Handler(s)                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `WorkItemChanged`             | `handleReadiness`, `handleImplementation`, `handleDependencyResolution`, `handleOrphanedWorkItem` |
| `RevisionChanged`             | `handleReview`                                                                                    |
| `SpecChanged`                 | `handlePlanning`                                                                                  |
| `PlannerRequested`            | _(no handler action)_                                                                             |
| `PlannerStarted`              | _(no handler action)_                                                                             |
| `PlannerCompleted`            | `handlePlanning`                                                                                  |
| `PlannerFailed`               | _(no handler action)_                                                                             |
| `ImplementorRequested`        | `handleImplementation`                                                                            |
| `ImplementorStarted`          | _(no handler action)_                                                                             |
| `ImplementorCompleted`        | `handleImplementation`                                                                            |
| `ImplementorFailed`           | `handleImplementation`                                                                            |
| `ReviewerRequested`           | _(no handler action)_                                                                             |
| `ReviewerStarted`             | _(no handler action)_                                                                             |
| `ReviewerCompleted`           | `handleReview`                                                                                    |
| `ReviewerFailed`              | `handleReview`                                                                                    |
| `CommandRejected`             | _(no handler action)_                                                                             |
| `CommandFailed`               | _(no handler action)_                                                                             |
| `UserRequestedImplementorRun` | `handleUserDispatch`                                                                              |
| `UserCancelledRun`            | `handleUserDispatch`                                                                              |
| `UserTransitionedStatus`      | `handleUserDispatch`                                                                              |

### Independence Invariant

Commands emitted by handlers in a single event cycle must be independent — no command may depend on
the effects of another command in the same cycle. The processing loop passes a single state snapshot
to all handlers and does not re-read state between command executions.

In practice, handlers produce at most one or two commands per event:

- **Single commands:** Most handler reactions produce exactly one command
  (`TransitionWorkItemStatus`, `RequestImplementorRun`, etc.).
- **Compound commands:** `ApplyPlannerResult`, `ApplyImplementorResult`, and `ApplyReviewerResult`
  encapsulate multi-step sequences that the CommandExecutor executes atomically. Dependent
  operations are expressed within a single compound command, not as separate commands in the same
  cycle.
- **Re-dispatch on completion:** `handlePlanning` may emit both `ApplyPlannerResult` and
  `RequestPlannerRun` for the same `PlannerCompleted` event. These are independent — applying the
  planner result does not affect whether specs require planning (the planner result creates/updates
  work items, not specs).

### Module Location

> **v2 module.** This is new v2 code implemented alongside the existing v1 engine. The v1 engine
> continues to function on `main` until the engine replacement (migration plan Step 8). Do not
> modify or delete v1 modules when implementing this spec.

Handlers live in `engine/handlers/`. Each handler is in its own file:

```
engine/handlers/
  types.ts
  create-handlers.ts
  handle-planning.ts
  handle-planning.test.ts
  handle-readiness.ts
  handle-readiness.test.ts
  handle-implementation.ts
  handle-implementation.test.ts
  handle-review.ts
  handle-review.test.ts
  handle-dependency-resolution.ts
  handle-dependency-resolution.test.ts
  handle-orphaned-work-item.ts
  handle-orphaned-work-item.test.ts
  handle-user-dispatch.ts
  handle-user-dispatch.test.ts
```

## Acceptance Criteria

- [ ] Given a `SpecChanged` event with `frontmatterStatus: 'draft'`, when `handlePlanning` runs,
      then no commands are emitted.
- [ ] Given a `SpecChanged` event for an approved spec whose `blobSHA` matches `lastPlannedSHAs`,
      when `handlePlanning` runs, then no commands are emitted.
- [ ] Given a `SpecChanged` event for an approved spec whose `blobSHA` differs from
      `lastPlannedSHAs`, when `handlePlanning` runs, then `RequestPlannerRun` is emitted with all
      approved spec paths (not only the changed spec).
- [ ] Given a `PlannerCompleted` event and no specs requiring planning remain, when `handlePlanning`
      runs, then only `ApplyPlannerResult` is emitted.
- [ ] Given a `PlannerCompleted` event and additional specs changed while the planner was running,
      when `handlePlanning` runs, then both `ApplyPlannerResult` and `RequestPlannerRun` are
      emitted.
- [ ] Given a `WorkItemChanged` event to `pending` with empty `blockedBy`, when `handleReadiness`
      runs, then `TransitionWorkItemStatus(ready)` is emitted.
- [ ] Given a `WorkItemChanged` event to `pending` with `blockedBy: ['B']` where B is `closed`, when
      `handleReadiness` runs, then `TransitionWorkItemStatus(ready)` is emitted.
- [ ] Given a `WorkItemChanged` event to `pending` with `blockedBy: ['B']` where B is not in
      terminal status, when `handleReadiness` runs, then no commands are emitted.
- [ ] Given a `WorkItemChanged` event to `pending` with `blockedBy: ['B']` where B is not present in
      the store, when `handleReadiness` runs, then no commands are emitted.
- [ ] Given an `ImplementorRequested` event, when `handleImplementation` runs, then
      `TransitionWorkItemStatus(in-progress)` is emitted for the event's work item.
- [ ] Given an `ImplementorFailed` event, when `handleImplementation` runs, then
      `TransitionWorkItemStatus(pending)` is emitted for the event's work item.
- [ ] Given a `RevisionChanged` event with `newPipelineStatus: 'success'` and `workItemID: null`,
      when `handleReview` runs, then no commands are emitted.
- [ ] Given a `RevisionChanged` event with `newPipelineStatus: 'success'` and the linked work item
      has status `approved`, when `handleReview` runs, then no commands are emitted.
- [ ] Given a `ReviewerFailed` event, when `handleReview` runs, then
      `TransitionWorkItemStatus(pending)` is emitted for the event's work item.
- [ ] Given a `WorkItemChanged` event to `closed` and a dependent work item in `pending` status
      whose remaining blockers are all in terminal status, when `handleDependencyResolution` runs,
      then `TransitionWorkItemStatus(ready)` is emitted for the dependent.
- [ ] Given a `WorkItemChanged` event to `closed` and a dependent work item in `pending` status with
      another unresolved blocker, when `handleDependencyResolution` runs, then no commands are
      emitted for that dependent.
- [ ] Given a `WorkItemChanged` event to `closed` and a dependent work item in `blocked` status with
      all blockers resolved, when `handleDependencyResolution` runs, then no commands are emitted
      for that dependent.
- [ ] Given a `WorkItemChanged` event to `in-progress` with an active agent run for the work item,
      when `handleOrphanedWorkItem` runs, then no commands are emitted.
- [ ] Given a `UserCancelledRun` event with a `sessionID` matching a planner run, when
      `handleUserDispatch` runs, then `CancelPlannerRun` is emitted.
- [ ] Given a `UserCancelledRun` event with a `sessionID` not present in `agentRuns`, when
      `handleUserDispatch` runs, then no commands are emitted.
- [ ] Given the handler list is reordered, when the same event and state are processed, then the
      same set of commands is produced.

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — Handler shape, wiring, catalog, domain events
  (`EngineEvent`), domain commands (`EngineCommand`), independence invariant.
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  selectors (`getSpecsRequiringPlanning`, `isWorkItemUnblocked`, `isAgentRunningForWorkItem`,
  `getWorkItemsDependingOn`).

## References

- [002-architecture.md: Handlers](./v2/002-architecture.md#handlers) — Handler shape, wiring, and
  catalog.
- [002-architecture.md: Agent Role Contracts](./v2/002-architecture.md#agent-role-contracts) —
  Per-role status flows and recovery patterns.
- [002-architecture.md: Recovery](./v2/002-architecture.md#recovery) — Crash recovery via
  `handleOrphanedWorkItem`.
- [001-plan.md](./v2/001-plan.md) — Decisions 8 (event/command flow), 9 (sequential processing), 11
  (handler-based dispatch), 12 (recovery via event pipeline).
