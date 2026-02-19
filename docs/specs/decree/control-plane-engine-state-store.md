---
title: Control Plane Engine — State Store
version: 0.3.0
last_updated: 2026-02-19
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
[domain-model.md: Specification](./domain-model.md#specification).

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
  error: string | null;
  startedAt: string; // ISO 8601
}

interface ImplementorRun {
  role: "implementor";
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  branchName: string;
  logFilePath: string | null;
  error: string | null;
  startedAt: string;
}

interface ReviewerRun {
  role: "reviewer";
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  revisionID: string;
  logFilePath: string | null;
  error: string | null;
  startedAt: string;
}

type AgentRun = PlannerRun | ImplementorRun | ReviewerRun;
```

### AgentRunStatus

See [Domain Model: Agent Run Lifecycle](./domain-model.md#agent-run-lifecycle) for the status enum
and transition table.

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
[domain-model.md: Domain Events](./domain-model.md#domain-events).

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
function applyStateUpdate(store: StoreApi<EngineState>, event: EngineEvent, logger: Logger): void;
```

The `logger` parameter is used to log warnings when an invalid state transition is attempted (e.g.,
a `sessionID` not found in `agentRuns` or a disallowed status transition). The warning is logged and
the update is rejected — the store state is not modified.

The dispatch is exhaustive — every `EngineEvent` variant has a corresponding entry. Adding a new
event type without a dispatch entry is a compile error.

**Dispatch table:**

| Event type                    | Update function             | Effect                                                  |
| ----------------------------- | --------------------------- | ------------------------------------------------------- |
| `workItemChanged`             | `applyWorkItemChanged`      | Upsert or remove work item                              |
| `revisionChanged`             | `applyRevisionChanged`      | Upsert or remove revision                               |
| `specChanged`                 | `applySpecChanged`          | Upsert spec                                             |
| `plannerRequested`            | `applyPlannerRequested`     | Create `PlannerRun` in `requested` status               |
| `plannerStarted`              | `applyPlannerStarted`       | Transition to `running`, set `logFilePath`              |
| `plannerCompleted`            | `applyPlannerCompleted`     | Transition to `completed`, update `lastPlannedSHAs`     |
| `plannerFailed`               | `applyPlannerFailed`        | Transition to terminal status per `reason`, set `error` |
| `implementorRequested`        | `applyImplementorRequested` | Create `ImplementorRun` in `requested` status           |
| `implementorStarted`          | `applyImplementorStarted`   | Transition to `running`, set `logFilePath`              |
| `implementorCompleted`        | `applyImplementorCompleted` | Transition to `completed`                               |
| `implementorFailed`           | `applyImplementorFailed`    | Transition to terminal status per `reason`, set `error` |
| `reviewerRequested`           | `applyReviewerRequested`    | Create `ReviewerRun` in `requested` status              |
| `reviewerStarted`             | `applyReviewerStarted`      | Transition to `running`, set `logFilePath`              |
| `reviewerCompleted`           | `applyReviewerCompleted`    | Transition to `completed`                               |
| `reviewerFailed`              | `applyReviewerFailed`       | Transition to terminal status per `reason`, set `error` |
| `commandRejected`             | `applyCommandRejected`      | Append `ErrorEntry` to `errors`                         |
| `commandFailed`               | `applyCommandFailed`        | Append `ErrorEntry` to `errors`                         |
| `userRequestedImplementorRun` | _(no-op)_                   | No state update — handled only by handlers              |
| `userCancelledRun`            | _(no-op)_                   | No state update — handled only by handlers              |
| `userTransitionedStatus`      | _(no-op)_                   | No state update — handled only by handlers              |

#### Entity Update Functions

**`applyWorkItemChanged(store, event)`:**

1. If `event.newStatus` is `null` (removal), call `workItems.delete(event.workItemID)`.
2. Otherwise, call `workItems.set(event.workItemID, event.workItem)`.

**`applyRevisionChanged(store, event)`:**

1. If `event.newPipelineStatus` is `null` (removal), call `revisions.delete(event.revisionID)`.
2. Otherwise, call `revisions.set(event.revisionID, event.revision)`.

**`applySpecChanged(store, event)`:**

1. Call
   `specs.set(event.filePath, { filePath: event.filePath, blobSHA: event.blobSHA, frontmatterStatus: event.frontmatterStatus })`.

#### Agent Lifecycle Update Functions

All agent lifecycle update functions that transition an existing run validate the status transition
against the transition table before applying. If the `sessionID` is not found in `agentRuns` or the
transition is invalid, the update is rejected and logged — the store state is not modified.

The three roles (planner, implementor, reviewer) follow an identical lifecycle pattern. The table
below summarizes each function's behavior; differences are noted in the **Additional Side Effects**
column.

| Function                    | Role          | Status Transition                        | Additional Side Effects                                             |
| --------------------------- | ------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `applyPlannerRequested`     | `planner`     | _(create)_ → `requested`                 | Creates `PlannerRun` with `specPaths` from event                    |
| `applyPlannerStarted`       | `planner`     | `requested` → `running`                  | Sets `logFilePath`                                                  |
| `applyPlannerCompleted`     | `planner`     | `running` → `completed`                  | Sets `logFilePath`; updates `lastPlannedSHAs` (see below)           |
| `applyPlannerFailed`        | `planner`     | current → terminal (derived from reason) | Sets `logFilePath`, `error`; does **not** update `lastPlannedSHAs`  |
| `applyImplementorRequested` | `implementor` | _(create)_ → `requested`                 | Creates `ImplementorRun` with `workItemID`, `branchName` from event |
| `applyImplementorStarted`   | `implementor` | `requested` → `running`                  | Sets `logFilePath`                                                  |
| `applyImplementorCompleted` | `implementor` | `running` → `completed`                  | Sets `logFilePath`                                                  |
| `applyImplementorFailed`    | `implementor` | current → terminal (derived from reason) | Sets `logFilePath`, `error`                                         |
| `applyReviewerRequested`    | `reviewer`    | _(create)_ → `requested`                 | Creates `ReviewerRun` with `workItemID`, `revisionID` from event    |
| `applyReviewerStarted`      | `reviewer`    | `requested` → `running`                  | Sets `logFilePath`                                                  |
| `applyReviewerCompleted`    | `reviewer`    | `running` → `completed`                  | Sets `logFilePath`                                                  |
| `applyReviewerFailed`       | `reviewer`    | current → terminal (derived from reason) | Sets `logFilePath`, `error`                                         |

**Common patterns:**

- **`*Requested`** functions create a new `AgentRun` entry in `agentRuns` keyed by
  `event.sessionID`, with `status: 'requested'`, `logFilePath: null`, `error: null`, and `startedAt`
  set to the current ISO 8601 timestamp. Role-specific fields are populated from the event (see
  AgentRun Variants above).
- **`*Started`** functions look up the run by `event.sessionID`, validate the transition to
  `running`, and set `logFilePath`.
- **`*Completed`** functions look up the run, validate the transition to `completed`, and set
  `logFilePath`.
- **`*Failed`** functions look up the run, derive the terminal status from `event.reason` (`error` →
  `failed`, `timeout` → `timed-out`, `cancelled` → `cancelled`), validate the transition, and set
  `logFilePath` and `error`.

**`applyPlannerCompleted` — `lastPlannedSHAs` update:**

For each spec path in the run's `specPaths`, look up the spec in `specs` by file path. If found, set
`lastPlannedSHAs.set(filePath, spec.blobSHA)`. If the spec is not in the `specs` map, skip it — do
not create an entry in `lastPlannedSHAs`.

> **Rationale:** Recording planned SHAs at completion time (using current spec blobSHAs from the
> store) prevents re-dispatch for specs that haven't changed since they were last planned. The
> planning handler compares incoming `SpecChanged` blobSHAs against these stored values.
> `lastPlannedSHAs` is not updated on failure, ensuring the next poll cycle re-detects the approved
> specs and re-triggers planning.

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
- [ ] Given a `RevisionChanged` event with `newPipelineStatus: null`, when the update is applied,
      then the revision is deleted from the `revisions` map.
- [ ] Given a `PlannerCompleted` event for specs A and B, when the update is applied, then
      `lastPlannedSHAs` contains the current `blobSHA` from the `specs` map for both A and B.
- [ ] Given a `PlannerCompleted` event references spec path X that is not in the `specs` map, when
      the update is applied, then `lastPlannedSHAs` is not updated for X.
- [ ] Given a `PlannerFailed` event, when the update is applied, then `lastPlannedSHAs` is not
      modified.
- [ ] Given a `*Failed` event with `reason: 'timeout'`, when the update is applied, then the agent
      run's status is set to `timed-out`.
- [ ] Given a `*Failed` event with `reason: 'cancelled'`, when the update is applied, then the agent
      run's status is set to `cancelled`.
- [ ] Given a `*Failed` event with `reason: 'error'`, when the update is applied, then the agent
      run's status is set to `failed`.
- [ ] Given two agent runs exist for the same work item (one `completed`, one `running`), when
      `isAgentRunningForWorkItem` is called, then it returns `true`.
- [ ] Given work item A has `blockedBy: ['B', 'C']` where B is `closed` and C does not exist in
      `workItems`, when `isWorkItemUnblocked` is called for A, then it returns `false`.
- [ ] Given `lastPlannedSHAs` has an entry for spec X with a matching `blobSHA`, when
      `getSpecsRequiringPlanning` is called, then spec X is not included in the result.
- [ ] Given a `userRequestedImplementorRun` event, when `applyStateUpdate` is called, then the store
      is not modified.

## Dependencies

- [domain-model.md](./domain-model.md) — Domain types (`WorkItem`, `Revision`, `Spec`,
  `EngineEvent`, `EngineCommand`, `CommandRejected`, `CommandFailed`), `AgentRunStatus` transition
  table, selector catalog.
- [Zustand](https://zustand-demo.pmnd.rs/) — Vanilla store (`zustand/vanilla`).

## References

- [domain-model.md: Agent Run Lifecycle](./domain-model.md#agent-run-lifecycle) — Status transition
  table and lifecycle semantics.
