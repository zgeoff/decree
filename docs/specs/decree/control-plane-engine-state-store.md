---
title: Control Plane Engine — State Store
version: 0.1.0
last_updated: 2026-02-16
status: approved
---

# Control Plane Engine — State Store

## Overview

The state store is the canonical source of truth for all engine state. It holds normalized domain
entities (work items, revisions, specs), agent run tracking, error history, and planner re-dispatch
prevention data. Built on a Zustand vanilla store, it is read exclusively through named selectors
and written exclusively by the processing loop's state update step.

## Constraints

- The store contains only data — no actions, no methods, no computed properties.
- All mutations go through `applyStateUpdate`, called exclusively by the processing loop.
- No component reads the raw store shape directly — all reads use named selectors.
- State update functions must not produce events or commands.

## Specification

### EngineState

```ts
interface EngineState {
  workItems: Map<string, WorkItem>;
  revisions: Map<string, Revision>;
  specs: Map<string, Spec>; // keyed by filePath
  agentRuns: Map<string, AgentRun>; // keyed by sessionID
  errors: ErrorEntry[];
  lastPlannedSHAs: Map<string, string>; // filePath → blobSHA
}
```

Domain types (`WorkItem`, `Revision`, `Spec`) are defined in
[002-architecture.md: Domain Model](./v2/002-architecture.md#domain-model).

### AgentRun Variants

Agent runs are per-role discriminated unions. Each variant carries only the fields relevant to its
role.

```ts
interface PlannerRun {
  role: "planner";
  sessionID: string;
  status: AgentRunStatus;
  specPaths: string[];
  logFilePath: string | null;
  startedAt: string; // ISO 8601
}

interface ImplementorRun {
  role: "implementor";
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  branchName: string;
  logFilePath: string | null;
  startedAt: string;
}

interface ReviewerRun {
  role: "reviewer";
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  revisionID: string;
  logFilePath: string | null;
  startedAt: string;
}

type AgentRun = PlannerRun | ImplementorRun | ReviewerRun;
```

### AgentRunStatus

```ts
type AgentRunStatus = "requested" | "running" | "completed" | "failed" | "timed-out" | "cancelled";
```

**Transition table:**

| From        | Allowed transitions                             |
| ----------- | ----------------------------------------------- |
| `requested` | `running`, `cancelled`                          |
| `running`   | `completed`, `failed`, `timed-out`, `cancelled` |
| `completed` | _(terminal)_                                    |
| `failed`    | _(terminal)_                                    |
| `timed-out` | _(terminal)_                                    |
| `cancelled` | _(terminal)_                                    |

State update functions validate transitions before applying them. Invalid transitions are logged and
rejected — the store state is not modified.

### ErrorEntry

```ts
interface ErrorEntry {
  event: CommandRejected | CommandFailed;
  timestamp: string; // ISO 8601
}
```

The `errors` list is bounded at **50 entries**. When a new entry would exceed the limit, the oldest
entry is evicted (index 0).

`CommandRejected` and `CommandFailed` event types are defined in
[002-architecture.md: Domain Events](./v2/002-architecture.md#domain-events).

### Store Creation

```ts
function createEngineStore(): StoreApi<EngineState>;
```

Returns a Zustand vanilla store (`zustand/vanilla`) initialized with empty state:

```ts
const INITIAL_STATE: EngineState = {
  workItems: new Map(),
  revisions: new Map(),
  specs: new Map(),
  agentRuns: new Map(),
  errors: [],
  lastPlannedSHAs: new Map(),
};
```

> **Rationale:** A vanilla Zustand store (no React dependency) allows the engine core to operate
> independently of the rendering layer. The TUI subscribes via Zustand's React binding for Ink
> components.

### State Updates

#### applyStateUpdate

The processing loop calls `applyStateUpdate` for every event before running handlers.

```ts
function applyStateUpdate(store: StoreApi<EngineState>, event: EngineEvent): void;
```

The dispatch is exhaustive — every `EngineEvent` variant has a corresponding entry. Adding a new
event type without a dispatch entry is a compile error.

**Dispatch table:**

| Event type                    | Update function             | Effect                                              |
| ----------------------------- | --------------------------- | --------------------------------------------------- |
| `workItemChanged`             | `applyWorkItemChanged`      | Upsert or remove work item                          |
| `revisionChanged`             | `applyRevisionChanged`      | Upsert revision                                     |
| `specChanged`                 | `applySpecChanged`          | Upsert spec                                         |
| `plannerRequested`            | `applyPlannerRequested`     | Create `PlannerRun` in `requested` status           |
| `plannerStarted`              | `applyPlannerStarted`       | Transition to `running`, set `logFilePath`          |
| `plannerCompleted`            | `applyPlannerCompleted`     | Transition to `completed`, update `lastPlannedSHAs` |
| `plannerFailed`               | `applyPlannerFailed`        | Transition to `failed`                              |
| `implementorRequested`        | `applyImplementorRequested` | Create `ImplementorRun` in `requested` status       |
| `implementorStarted`          | `applyImplementorStarted`   | Transition to `running`, set `logFilePath`          |
| `implementorCompleted`        | `applyImplementorCompleted` | Transition to `completed`                           |
| `implementorFailed`           | `applyImplementorFailed`    | Transition to `failed`                              |
| `reviewerRequested`           | `applyReviewerRequested`    | Create `ReviewerRun` in `requested` status          |
| `reviewerStarted`             | `applyReviewerStarted`      | Transition to `running`, set `logFilePath`          |
| `reviewerCompleted`           | `applyReviewerCompleted`    | Transition to `completed`                           |
| `reviewerFailed`              | `applyReviewerFailed`       | Transition to `failed`                              |
| `commandRejected`             | `applyCommandRejected`      | Append `ErrorEntry` to `errors`                     |
| `commandFailed`               | `applyCommandFailed`        | Append `ErrorEntry` to `errors`                     |
| `userRequestedImplementorRun` | _(no-op)_                   | No state update — handled only by handlers          |
| `userCancelledRun`            | _(no-op)_                   | No state update — handled only by handlers          |
| `userTransitionedStatus`      | _(no-op)_                   | No state update — handled only by handlers          |

#### Entity Update Functions

**`applyWorkItemChanged(store, event)`:**

1. If `event.newStatus` is `null` (removal), delete `event.workItemID` from `workItems`.
2. Otherwise, set `workItems[event.workItemID]` to `event.workItem`.

**`applyRevisionChanged(store, event)`:**

1. Set `revisions[event.revisionID]` to `event.revision`.

**`applySpecChanged(store, event)`:**

1. Set `specs[event.filePath]` to
   `{ filePath: event.filePath, blobSHA: event.blobSHA, frontmatterStatus: event.frontmatterStatus }`.

#### Agent Lifecycle Update Functions

All agent lifecycle update functions that transition an existing run validate the status transition
against the transition table before applying. If the `sessionID` is not found in `agentRuns` or the
transition is invalid, the update is rejected and logged — the store state is not modified.

**`applyPlannerRequested(store, event)`:**

1. Create a `PlannerRun` entry in `agentRuns` keyed by `event.sessionID`:
   `{ role: 'planner', sessionID: event.sessionID, status: 'requested', specPaths: event.specPaths, logFilePath: null, startedAt: <current ISO 8601 timestamp> }`.

**`applyPlannerStarted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition from current status to `running`.
2. Set `status` to `'running'` and `logFilePath` to `event.logFilePath`.

**`applyPlannerCompleted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition from current status to `completed`.
2. Set `status` to `'completed'` and `logFilePath` to `event.logFilePath`.
3. For each spec path in the run's `specPaths`, look up the spec in `specs` by file path. If found,
   set `lastPlannedSHAs[filePath]` to the spec's current `blobSHA`. If the spec is not in the
   `specs` map, skip it — do not create an entry in `lastPlannedSHAs`.

> **Rationale:** Recording planned SHAs at completion time (using current spec blobSHAs from the
> store) prevents re-dispatch for specs that haven't changed since they were last planned. The
> planning handler compares incoming `SpecChanged` blobSHAs against these stored values.

**`applyPlannerFailed(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition from current status to `failed`.
2. Set `status` to `'failed'` and `logFilePath` to `event.logFilePath`.

> **Rationale:** `lastPlannedSHAs` is not updated on failure, ensuring the next poll cycle
> re-detects the approved specs and re-triggers planning.

**`applyImplementorRequested(store, event)`:**

1. Create an `ImplementorRun` entry in `agentRuns` keyed by `event.sessionID`:
   `{ role: 'implementor', sessionID: event.sessionID, status: 'requested', workItemID: event.workItemID, branchName: event.branchName, logFilePath: null, startedAt: <current ISO 8601 timestamp> }`.

**`applyImplementorStarted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `running`.
2. Set `status` to `'running'` and `logFilePath` to `event.logFilePath`.

**`applyImplementorCompleted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `completed`.
2. Set `status` to `'completed'` and `logFilePath` to `event.logFilePath`.

**`applyImplementorFailed(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `failed`.
2. Set `status` to `'failed'` and `logFilePath` to `event.logFilePath`.

**`applyReviewerRequested(store, event)`:**

1. Create a `ReviewerRun` entry in `agentRuns` keyed by `event.sessionID`:
   `{ role: 'reviewer', sessionID: event.sessionID, status: 'requested', workItemID: event.workItemID, revisionID: event.revisionID, logFilePath: null, startedAt: <current ISO 8601 timestamp> }`.

**`applyReviewerStarted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `running`.
2. Set `status` to `'running'` and `logFilePath` to `event.logFilePath`.

**`applyReviewerCompleted(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `completed`.
2. Set `status` to `'completed'` and `logFilePath` to `event.logFilePath`.

**`applyReviewerFailed(store, event)`:**

1. Look up the run by `event.sessionID`. Validate transition to `failed`.
2. Set `status` to `'failed'` and `logFilePath` to `event.logFilePath`.

#### Error Update Functions

**`applyCommandRejected(store, event)`:**

1. Append `{ event, timestamp: <current ISO 8601 timestamp> }` to `errors`.
2. If `errors.length` exceeds 50, remove the oldest entry (index 0).

**`applyCommandFailed(store, event)`:**

1. Append `{ event, timestamp: <current ISO 8601 timestamp> }` to `errors`.
2. If `errors.length` exceeds 50, remove the oldest entry (index 0).

### Selectors

Selectors are pure functions that derive values from `EngineState`. Each lives in a dedicated file
under `engine/state-store/selectors/`.

| Selector                       | Signature                                            | Description                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getWorkItemsByStatus`         | `(state, status) → WorkItem[]`                       | All work items with the given status.                                                                                                                                                                                |
| `getActiveAgentRun`            | `(state, workItemID) → AgentRun \| null`             | The agent run with status `requested` or `running` for the given work item. Returns `null` if none. Scans `ImplementorRun` and `ReviewerRun` entries (not `PlannerRun`).                                             |
| `getActivePlannerRun`          | `(state) → PlannerRun \| null`                       | The planner run with status `requested` or `running`. Returns `null` if none.                                                                                                                                        |
| `isAgentRunningForWorkItem`    | `(state, workItemID) → boolean`                      | `true` if any agent run with the given `workItemID` has status `requested` or `running`.                                                                                                                             |
| `getRevisionsByPipelineStatus` | `(state, status) → Revision[]`                       | All revisions whose `pipeline.status` matches the given status. Revisions with `pipeline: null` are excluded.                                                                                                        |
| `getWorkItemWithRevision`      | `(state, workItemID) → WorkItemWithRevision \| null` | The work item and its linked revision (via `workItem.linkedRevision`). Returns `null` if the work item does not exist or has no linked revision.                                                                     |
| `getSpecsRequiringPlanning`    | `(state) → Spec[]`                                   | Specs with `frontmatterStatus: 'approved'` whose `blobSHA` differs from the corresponding `lastPlannedSHAs` entry or has no entry.                                                                                   |
| `getWorkItemsDependingOn`      | `(state, workItemID) → WorkItem[]`                   | Work items that include the given `workItemID` in their `blockedBy` list.                                                                                                                                            |
| `isWorkItemUnblocked`          | `(state, workItem) → boolean`                        | `true` if every ID in `workItem.blockedBy` maps to a work item in terminal status (`closed` or `approved`). Returns `true` if `blockedBy` is empty. Returns `false` if any blocker ID is not present in `workItems`. |

**Return types:**

```ts
interface WorkItemWithRevision {
  workItem: WorkItem;
  revision: Revision;
}
```

### Module Location

The state store lives in `engine/state-store/`. Directory structure:

```
engine/state-store/
  types.ts
  create-engine-store.ts
  apply-state-update.ts
  selectors/
    get-work-items-by-status.ts
    get-active-agent-run.ts
    get-active-planner-run.ts
    is-agent-running-for-work-item.ts
    get-revisions-by-pipeline-status.ts
    get-work-item-with-revision.ts
    get-specs-requiring-planning.ts
    get-work-items-depending-on.ts
    is-work-item-unblocked.ts
```

## Acceptance Criteria

- [ ] Given an agent run is in `completed` status, when a state update attempts to transition it to
      `running`, then the transition is rejected and the store is not modified.
- [ ] Given a `PlannerStarted` event with a `sessionID` not present in `agentRuns`, when the update
      is applied, then the update is rejected and the store is not modified.
- [ ] Given the error list contains 50 entries, when a new `CommandRejected` event is applied, then
      the oldest entry is evicted and the new entry is appended (list size remains 50).
- [ ] Given a `WorkItemChanged` event with `newStatus: null`, when the update is applied, then the
      work item is deleted from the `workItems` map.
- [ ] Given a `PlannerCompleted` event for specs A and B, when the update is applied, then
      `lastPlannedSHAs` contains the current `blobSHA` from the `specs` map for both A and B.
- [ ] Given a `PlannerCompleted` event references spec path X that is not in the `specs` map, when
      the update is applied, then `lastPlannedSHAs` is not updated for X.
- [ ] Given a `PlannerFailed` event, when the update is applied, then `lastPlannedSHAs` is not
      modified.
- [ ] Given two agent runs exist for the same work item (one `completed`, one `running`), when
      `isAgentRunningForWorkItem` is called, then it returns `true`.
- [ ] Given work item A has `blockedBy: ['B', 'C']` where B is `closed` and C does not exist in
      `workItems`, when `isWorkItemUnblocked` is called for A, then it returns `false`.
- [ ] Given `lastPlannedSHAs` has an entry for spec X with a matching `blobSHA`, when
      `getSpecsRequiringPlanning` is called, then spec X is not included in the result.
- [ ] Given a `userRequestedImplementorRun` event, when `applyStateUpdate` is called, then the store
      is not modified.

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — Domain types (`WorkItem`, `Revision`, `Spec`,
  `EngineEvent`, `EngineCommand`, `CommandRejected`, `CommandFailed`), `AgentRunStatus` transition
  table, selector catalog.
- [Zustand](https://zustand-demo.pmnd.rs/) — Vanilla store (`zustand/vanilla`).

## References

- [002-architecture.md: State Store](./v2/002-architecture.md#state-store) — Canonical state shape
  and store design.
- [002-architecture.md: State Updates](./v2/002-architecture.md#state-updates) — `applyStateUpdate`
  dispatch pseudocode.
- [002-architecture.md: Selectors](./v2/002-architecture.md#selectors) — Named selector catalog.
- [002-architecture.md: Agent Run Lifecycle](./v2/002-architecture.md#agent-run-lifecycle) — Status
  transition table and lifecycle semantics.
