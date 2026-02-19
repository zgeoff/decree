---
title: Control Plane Engine — CommandExecutor
version: 0.1.0
last_updated: 2026-02-17
status: approved
---

# Control Plane Engine — CommandExecutor

## Overview

The CommandExecutor is the broker boundary — the single path for all external mutations. It receives
domain commands from handlers, checks concurrency guards and policy, translates commands into
provider operations, and emits result events back into the event queue. No component bypasses this
boundary to perform external writes.

## Constraints

- All external mutations flow through the CommandExecutor — no handler, poller, or TUI component
  calls provider writers or runtime adapters directly.
- The CommandExecutor does not retry failed commands. Provider-internal retry handles transient
  failures. If a provider call fails after retries are exhausted, the executor emits `CommandFailed`
  and moves on.
- The CommandExecutor does not read from or write to the state store. It receives a `state` snapshot
  from the processing loop and uses selectors for guard checks. State mutations happen only through
  events processed by `applyStateUpdate`.
- Commands that violate concurrency guards or policy are rejected with `CommandRejected` — never
  silently dropped.

## Specification

### createCommandExecutor

```ts
interface CommandExecutorDeps {
  workItemWriter: WorkProviderWriter;
  revisionWriter: RevisionProviderWriter;
  runtimeAdapters: Record<AgentRole, RuntimeAdapter>;
  policy: Policy;
  getState: () => EngineState;
  enqueue: (event: EngineEvent) => void;
}

interface CommandExecutor {
  execute(command: EngineCommand, state: EngineState): Promise<EngineEvent[]>;
}

// createCommandExecutor(deps: CommandExecutorDeps): CommandExecutor
```

`getState` and `enqueue` are used by `startAgentAsync` — the async monitor needs to enqueue agent
lifecycle events after the synchronous `execute` call has returned. The `state` parameter on
`execute` is the snapshot passed by the processing loop for guard and policy checks.

> **Rationale:** The processing loop passes a single state snapshot to all handlers and the executor
> within one event cycle. The executor does not re-read state between command executions — this
> preserves the independence invariant.

### Execution Pipeline

For each command, the executor runs the following pipeline:

1. **Concurrency guards.** Check operational constraints against the state snapshot. If a guard
   rejects, return `[CommandRejected { command, reason }]`. Do not proceed to policy or execution.
2. **Policy gate.** Call `policy(command, state)`. If disallowed, return
   `[CommandRejected { command, reason: policyResult.reason }]`.
3. **Command translation.** Match on the command type and call the appropriate provider operation(s)
   or runtime adapter method. This includes any state lookups needed to resolve command parameters
   (e.g. `reviewID`, `branchName`, revision). Return result events on success.
4. **Error handling.** If any operation in step 3 throws — whether a state lookup failure, a
   provider call, or a runtime adapter call — catch the error and return
   `[CommandFailed { command, error: error.message }]`.

```ts
async execute(command, state):
  guardResult = checkConcurrencyGuards(command, state)
  if not guardResult.allowed:
    return [CommandRejected { command, reason: guardResult.reason }]

  policyResult = policy(command, state)
  if not policyResult.allowed:
    return [CommandRejected { command, reason: policyResult.reason }]

  try:
    return translateAndExecute(command, state)
  catch error:
    return [CommandFailed { command, error: error.message }]
```

### Concurrency Guards

Guards are checked before policy. They enforce operational constraints by reading state via
selectors.

| Guard                   | Applies to              | Condition                                                             | Rejection reason                        |
| ----------------------- | ----------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| One planner at a time   | `RequestPlannerRun`     | `getActivePlannerRun(state)` returns non-null                         | `'planner already running'`             |
| One agent per work item | `RequestImplementorRun` | `isAgentRunningForWorkItem(state, command.workItemID)` returns `true` | `'agent already running for work item'` |
| One agent per work item | `RequestReviewerRun`    | `isAgentRunningForWorkItem(state, command.workItemID)` returns `true` | `'agent already running for work item'` |

Commands not listed in this table have no concurrency guards — they proceed directly to the policy
gate.

> **Rationale:** Concurrency guards are enforced in the CommandExecutor rather than handlers because
> handlers are pure decision functions. Centralizing guard logic here prevents race conditions from
> multiple handler emissions in the same event cycle.

### Policy Gate

```ts
type Policy = (command: EngineCommand, state: EngineState) => PolicyResult;

interface PolicyResult {
  allowed: boolean;
  reason: string | null; // populated when disallowed
}
```

Policy is a boolean gate — it does not modify commands. The policy function is injected at setup
time via `CommandExecutorDeps.policy`.

### Command Translation

Each command type maps to one or more provider operations and produces zero or more result events.

#### Entity-Mutating Commands

Commands that create or transition entities the engine tracks produce result events so the engine
state stays in sync immediately. Pollers detect **external** changes (made outside the engine); the
executor produces events for **engine-initiated** changes.

| Command                    | Provider operation                                              | Result events       |
| -------------------------- | --------------------------------------------------------------- | ------------------- |
| `TransitionWorkItemStatus` | `workItemWriter.transitionStatus(workItemID, newStatus)`        | `[WorkItemChanged]` |
| `CreateWorkItem`           | `workItemWriter.createWorkItem(title, body, labels, blockedBy)` | `[WorkItemChanged]` |
| `CreateRevisionFromPatch`  | `revisionWriter.createFromPatch(workItemID, patch, branchName)` | `[RevisionChanged]` |

**Event construction:**

**`TransitionWorkItemStatus`:** The executor builds the event from the command fields and the state
snapshot. It clones the work item from `state.workItems`, sets the new status, and constructs:

```ts
WorkItemChanged {
  type:      'workItemChanged'
  workItemID: command.workItemID
  workItem:   { ...existingWorkItem, status: command.newStatus }
  title:      existingWorkItem.title
  oldStatus:  existingWorkItem.status
  newStatus:  command.newStatus
  priority:   existingWorkItem.priority
}
```

**`CreateWorkItem`:** The provider returns the created `WorkItem`. The executor constructs:

```ts
WorkItemChanged {
  type:      'workItemChanged'
  workItemID: createdWorkItem.id
  workItem:   createdWorkItem
  title:      createdWorkItem.title
  oldStatus:  null
  newStatus:  createdWorkItem.status
  priority:   createdWorkItem.priority
}
```

**`CreateRevisionFromPatch`:** The provider returns the created `Revision`. The executor constructs:

```ts
RevisionChanged {
  type:              'revisionChanged'
  revisionID:        createdRevision.id
  workItemID:        command.workItemID
  revision:          createdRevision
  oldPipelineStatus: null
  newPipelineStatus: createdRevision.pipeline?.status ?? null
}
```

> **Rationale:** `transitionStatus` returns `void` — the executor already has the work item in the
> state snapshot and can construct the updated entity by setting the new status. `createWorkItem`
> and `createFromPatch` return the created entity because it is genuinely new (not yet in state). No
> provider interface changes are needed.

**Poller deduplication:** When the poller next runs, the executor's event has already been applied
to the store via `applyStateUpdate`. The poller diffs against the store and finds no difference for
that entity — no duplicate event is produced.

#### Fire-and-Forget Commands

Commands that modify ancillary data (bodies, labels, comments, reviews) not tracked in the engine's
entity maps produce no result events. These changes do not drive handler logic.

| Command              | Provider operation                                        | Result events |
| -------------------- | --------------------------------------------------------- | ------------- |
| `UpdateWorkItem`     | `workItemWriter.updateWorkItem(workItemID, body, labels)` | `[]`          |
| `UpdateRevision`     | `revisionWriter.updateBody(revisionID, body)`             | `[]`          |
| `PostRevisionReview` | `revisionWriter.postReview(revisionID, review)`           | `[]`          |
| `CommentOnRevision`  | `revisionWriter.postComment(revisionID, body)`            | `[]`          |

**`UpdateRevisionReview` requires state lookup.** The command carries `revisionID` and `review` but
not `reviewID`. The executor resolves `reviewID` by finding the revision in the state snapshot whose
`id` matches `command.revisionID` and reading its `reviewID` field. If the revision is not found or
`reviewID` is `null`, the command fails.

| Command                | Resolution                                              | Provider operation                                          | Result events |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| `UpdateRevisionReview` | Look up `reviewID` from `revisions[command.revisionID]` | `revisionWriter.updateReview(revisionID, reviewID, review)` | `[]`          |

#### Agent Request Commands

| Command                 | Operations                                                                                      | Synchronous result events                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `RequestPlannerRun`     | Generate `sessionID`, call `startAgentAsync('planner', sessionID, params)`                      | `[PlannerRequested { sessionID, specPaths }]`                  |
| `RequestImplementorRun` | Generate `sessionID` and `branchName`, call `startAgentAsync('implementor', sessionID, params)` | `[ImplementorRequested { sessionID, workItemID, branchName }]` |
| `RequestReviewerRun`    | Generate `sessionID`, call `startAgentAsync('reviewer', sessionID, params)`                     | `[ReviewerRequested { sessionID, workItemID, revisionID }]`    |

Agent request commands produce an immediate `*Requested` event (returned synchronously by `execute`)
and start an async lifecycle monitor. See [startAgentAsync](#startagentasync) for the async
lifecycle.

#### Agent Cancel Commands

| Command                | Resolution                                           | Operations                                           | Result events |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------- |
| `CancelPlannerRun`     | `getActivePlannerRun(state)` → `sessionID`           | `runtimeAdapters.planner.cancelAgent(sessionID)`     | `[]`          |
| `CancelImplementorRun` | `getActiveAgentRun(state, workItemID)` → `sessionID` | `runtimeAdapters.implementor.cancelAgent(sessionID)` | `[]`          |
| `CancelReviewerRun`    | `getActiveAgentRun(state, workItemID)` → `sessionID` | `runtimeAdapters.reviewer.cancelAgent(sessionID)`    | `[]`          |

Cancel commands carry `workItemID` (or nothing for planner). The executor resolves the `sessionID`
via selectors before calling the runtime adapter. If no active run is found, the command is a no-op
— no error, no event.

> **Rationale:** Cancel commands use work item identity (or global identity for planner) rather than
> session identity because the caller (handler or TUI) operates in domain terms. The executor
> resolves the session internally.

#### Compound Commands

Compound commands encapsulate multi-step, interdependent operations that cannot be expressed as
independent commands in the same event cycle.

##### ApplyPlannerResult

Processes the planner's structured output: creates new work items, closes existing ones, and updates
existing ones. Collects result events from entity-mutating operations and returns them.

1. Initialize `resultEvents = []`.
2. **Process creates in order.** For each entry in `result.create`: a. Resolve `blockedBy`
   references — replace any `tempID` values with real work item IDs from previously created items in
   this batch. IDs not matching any `create[].tempID` are treated as existing work item IDs and
   passed through unchanged. b. Call
   `workItemWriter.createWorkItem(entry.title, entry.body, entry.labels, resolvedBlockedBy)`. c.
   Record the mapping: `entry.tempID` → created work item's `id`. d. Append a `WorkItemChanged`
   event (same construction as `CreateWorkItem`).

3. **Process closes.** For each `workItemID` in `result.close`: a. Call
   `workItemWriter.transitionStatus(workItemID, 'closed')`. b. Append a `WorkItemChanged` event
   (same construction as `TransitionWorkItemStatus`).

4. **Process updates.** For each entry in `result.update`: a. Call
   `workItemWriter.updateWorkItem(entry.workItemID, entry.body, entry.labels)`. b. No event —
   `UpdateWorkItem` is fire-and-forget.

5. **Return `resultEvents`.**

If any step fails, the error propagates immediately — previously completed operations within the
batch are not rolled back. Events collected before the failure are not returned — the
`CommandFailed` event carries the original `ApplyPlannerResult` command. The pollers will detect the
partially-applied state on the next cycle.

> **Rationale:** Creates are processed in order because later entries may reference earlier entries'
> `tempID` values in their `blockedBy` lists. The tempID → real ID mapping must be built
> incrementally.

##### ApplyImplementorResult

Processes the implementor's structured output based on the outcome.

**Outcome: `completed`**

1. Read `branchName` from `command.branchName`.
2. Call `revisionWriter.createFromPatch(command.workItemID, result.patch, branchName)`.
3. Construct a `RevisionChanged` event (same construction as `CreateRevisionFromPatch`).
4. Call `workItemWriter.transitionStatus(command.workItemID, 'review')`.
5. Construct a `WorkItemChanged` event (same construction as `TransitionWorkItemStatus`).
6. Return `[RevisionChanged, WorkItemChanged]`.

**Outcome: `blocked`**

1. Call `workItemWriter.transitionStatus(command.workItemID, 'blocked')`.
2. Return `[WorkItemChanged]` (same construction as `TransitionWorkItemStatus`).

**Outcome: `validation-failure`**

1. Call `workItemWriter.transitionStatus(command.workItemID, 'needs-refinement')`.
2. Return `[WorkItemChanged]` (same construction as `TransitionWorkItemStatus`).

> **Rationale:** The `completed` outcome requires two interdependent operations — the revision must
> be created before the status transition to `review` is meaningful. Expressing these as a compound
> command ensures they execute atomically within the broker boundary.

##### ApplyReviewerResult

Processes the reviewer's structured output: posts or updates the review and transitions the work
item status based on the verdict.

1. Look up the current revision via `getWorkItemWithRevision(state, command.workItemID)`. Throws if
   the work item or linked revision is not found.
2. **Review posting:** a. If `revision.reviewID` is `null` — no prior engine-posted review exists.
   Call `revisionWriter.postReview(command.revisionID, result.review)`. b. If `revision.reviewID` is
   non-null — a prior engine-posted review exists. Call
   `revisionWriter.updateReview(command.revisionID, revision.reviewID, result.review)`.
3. **Status transition:** a. If `result.review.verdict` is `'approve'`: call
   `workItemWriter.transitionStatus(command.workItemID, 'approved')`. b. If `result.review.verdict`
   is `'needs-changes'`: call
   `workItemWriter.transitionStatus(command.workItemID, 'needs-refinement')`.
4. Return `[WorkItemChanged]` (same construction as `TransitionWorkItemStatus`). Review posting is
   fire-and-forget — no event produced for it.

### startAgentAsync

The async lifecycle manager for agent runs. Called by agent request command translations. It runs
outside the synchronous `execute` call and enqueues events via `deps.enqueue`.

```ts
async startAgentAsync(role, sessionID, params):
  try:
    handle = await runtimeAdapters[role].startAgent(params)
    enqueue(buildStartedEvent(role, sessionID, handle.logFilePath))
    result = await handle.result
    enqueue(buildCompletedEvent(role, sessionID, result))
  catch error:
    enqueue(buildFailedEvent(role, sessionID, error))
```

**Lifecycle events by role:**

| Role          | Started event        | Completed event        | Failed event        |
| ------------- | -------------------- | ---------------------- | ------------------- |
| `planner`     | `PlannerStarted`     | `PlannerCompleted`     | `PlannerFailed`     |
| `implementor` | `ImplementorStarted` | `ImplementorCompleted` | `ImplementorFailed` |
| `reviewer`    | `ReviewerStarted`    | `ReviewerCompleted`    | `ReviewerFailed`    |

`startAgent` may involve provisioning (worktree setup, sandbox allocation). When it resolves, a
`*Started` event is enqueued, transitioning the run from `requested` to `running`. When the agent
completes or fails, the corresponding terminal event is enqueued for normal sequential processing.

The engine retains the `AgentRunHandle` returned by `startAgent` in a private
`Map<string, AgentRunHandle>` keyed by `sessionID`. This handle is used by `engine.getAgentStream`
to provide live output to the TUI. The handle is removed when the run reaches a terminal state.

### AgentStartParams Construction

The executor builds per-role `AgentStartParams` from the command fields:

| Command                 | AgentStartParams                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RequestPlannerRun`     | `{ role: 'planner', specPaths: command.specPaths }`                                                                         |
| `RequestImplementorRun` | `{ role: 'implementor', workItemID: command.workItemID, branchName }` (see [branchName Generation](#branchname-generation)) |
| `RequestReviewerRun`    | `{ role: 'reviewer', workItemID: command.workItemID, revisionID: command.revisionID }`                                      |

### branchName Generation

For `RequestImplementorRun`, the executor generates `branchName` before starting the agent. The
branch name is derived from the work item using a convention-based format:

```
decree/<workItemID>
```

The generated `branchName` is included in both the `ImplementorStartParams` (passed to the runtime
adapter) and the `ImplementorRequested` event (recorded in the `ImplementorRun` state). This ensures
the runtime adapter and the provider writer (`createFromPatch`) use the same branch.

### Session ID Generation

The executor generates a unique `sessionID` for each agent request command. The `sessionID` is a
UUID v4 string. It is included in the `*Requested` event and used as the key for the `agentRuns` map
in the state store.

### Module Location

The CommandExecutor lives in `engine/command-executor/`. Directory structure:

```
engine/command-executor/
  types.ts
  create-command-executor.ts
  check-concurrency-guards.ts
  translate-and-execute.ts
  start-agent-async.ts
  build-branch-name.ts
```

`RuntimeAdapter`, `AgentRunHandle`, and `AgentStartParams` (per-role) are defined in
[control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md).

`Policy` and `PolicyResult` are owned by this module — the CommandExecutor is the sole consumer.

## Acceptance Criteria

### Concurrency Guards

- [ ] Given a planner run with status `running` exists, when `RequestPlannerRun` is executed, then
      `CommandRejected` is returned and no agent is started.
- [ ] Given a planner run with status `requested` exists, when `RequestPlannerRun` is executed, then
      `CommandRejected` is returned.
- [ ] Given an implementor run with status `running` exists for work item A, when
      `RequestImplementorRun` for work item A is executed, then `CommandRejected` is returned.
- [ ] Given a reviewer run with status `running` exists for work item A, when
      `RequestImplementorRun` for work item A is executed, then `CommandRejected` is returned (one
      agent per work item, regardless of role).
- [ ] Given no active agent run exists for work item B, when `RequestImplementorRun` for work item B
      is executed, then the command proceeds past the concurrency guard.
- [ ] Given a `TransitionWorkItemStatus` command, when executed, then no concurrency guard is
      checked.

### Entity-Mutating Commands

- [ ] Given `TransitionWorkItemStatus` for a work item currently in `ready`, when executed, then the
      returned `WorkItemChanged` event has `oldStatus: 'ready'`, `newStatus` matching the command,
      and a `workItem` snapshot with the updated status.
- [ ] Given `CreateWorkItem` is executed, when the provider returns the created work item, then the
      returned `WorkItemChanged` event has `oldStatus: null` and `workItem` matching the provider
      return value.
- [ ] Given `CreateRevisionFromPatch` is executed, when the provider returns the created revision,
      then the returned `RevisionChanged` event has `oldPipelineStatus: null` and `revision`
      matching the provider return value.
- [ ] Given `UpdateWorkItem` is executed, when the provider call succeeds, then `execute` returns
      `[]` (no events).
- [ ] Given `CommentOnRevision` is executed, when the provider call succeeds, then `execute` returns
      `[]` (no events).

### State-Lookup Commands

- [ ] Given `UpdateRevisionReview` is executed and the revision exists in state with
      `reviewID: '99'`, when the command runs, then `updateReview` is called with `reviewID: '99'`.
- [ ] Given `UpdateRevisionReview` is executed and the revision's `reviewID` is `null`, when the
      command runs, then `CommandFailed` is returned.
- [ ] Given `UpdateRevisionReview` is executed and the revision is not found in state, when the
      command runs, then `CommandFailed` is returned.

### Policy Gate

- [ ] Given the policy function returns `{ allowed: false, reason: 'manual only' }`, when any
      command is executed, then `CommandRejected` is returned with reason `'manual only'` and no
      provider operation is called.
- [ ] Given the concurrency guard rejects a command, when executed, then the policy function is
      never called.

### Error Handling

- [ ] Given a provider writer throws an error, when the command is executed, then `CommandFailed` is
      returned with the error message and no other events are produced.
- [ ] Given `startAgent` throws during `startAgentAsync`, when the error is caught, then a `*Failed`
      event is enqueued (not returned synchronously).

### Agent Request Commands

- [ ] Given `RequestPlannerRun` is executed successfully, when `execute` returns, then the result
      contains exactly one `PlannerRequested` event with a generated `sessionID` and the command's
      `specPaths`.
- [ ] Given `RequestImplementorRun` is executed successfully, when `execute` returns, then the
      result contains exactly one `ImplementorRequested` event with a generated `sessionID`, the
      command's `workItemID`, and a generated `branchName`.
- [ ] Given `RequestImplementorRun` for work item 42 titled "Add login", when `branchName` is
      generated, then it follows the format `decree/<workItemID>`.

### Agent Cancel Commands

- [ ] Given `CancelImplementorRun` for work item A with an active implementor run, when executed,
      then `cancelAgent` is called with the run's `sessionID`.
- [ ] Given `CancelPlannerRun` with no active planner run, when executed, then no error is produced
      and no runtime adapter method is called.
- [ ] Given `CancelImplementorRun` for work item B with no active agent run, when executed, then no
      error is produced and no runtime adapter method is called.

### startAgentAsync Lifecycle

- [ ] Given `startAgent` resolves with a handle, when the result promise resolves, then `*Completed`
      is enqueued with the result.
- [ ] Given `startAgent` resolves with a handle, when the result promise rejects, then `*Failed` is
      enqueued with the error.
- [ ] Given `startAgent` itself rejects (provisioning failure), when the error is caught, then
      `*Failed` is enqueued without a preceding `*Started` event.

### Compound Commands

- [ ] Given `ApplyPlannerResult` with two creates where the second references the first's `tempID`
      in `blockedBy`, when executed, then the second `createWorkItem` call receives the real ID of
      the first created work item.
- [ ] Given `ApplyPlannerResult` with a create, a close, and an update, when executed, then creates
      are processed first, then closes, then updates.
- [ ] Given `ApplyPlannerResult` with two creates and one close, when executed, then the result
      contains three `WorkItemChanged` events (two with `oldStatus: null`, one with
      `newStatus: 'closed'`).
- [ ] Given `ApplyPlannerResult` where the second create fails, when the error occurs, then the
      first create is not rolled back, events collected before the failure are not returned, and
      `CommandFailed` is returned.
- [ ] Given `ApplyImplementorResult` with outcome `completed`, when executed, then `createFromPatch`
      is called before `transitionStatus` to `review`, and the result contains
      `[RevisionChanged, WorkItemChanged]`.
- [ ] Given `ApplyImplementorResult` with outcome `blocked`, when executed, then the result contains
      one `WorkItemChanged` event with `newStatus: 'blocked'` and `createFromPatch` is not called.
- [ ] Given `ApplyImplementorResult` with outcome `completed`, when `branchName` is needed, then it
      is read from `command.branchName` (carried through from the `ImplementorCompleted` event).
- [ ] Given `ApplyReviewerResult` where the work item has no linked revision in state, when the
      lookup fails, then `CommandFailed` is returned.
- [ ] Given `ApplyReviewerResult` where the revision has no prior engine-posted review
      (`reviewID: null`), when executed, then `postReview` is called (not `updateReview`).
- [ ] Given `ApplyReviewerResult` where the revision has a prior engine-posted review
      (`reviewID: '99'`), when executed, then `updateReview` is called with `reviewID: '99'`.
- [ ] Given `ApplyReviewerResult` with verdict `approve`, when executed, then the result contains
      one `WorkItemChanged` event with `newStatus: 'approved'`.
- [ ] Given `ApplyReviewerResult` with verdict `needs-changes`, when executed, then the result
      contains one `WorkItemChanged` event with `newStatus: 'needs-refinement'`.

## Dependencies

- [domain-model.md](./domain-model.md) — Domain commands (`EngineCommand` union), domain events
  (`EngineEvent` union, `CommandRejected`, `CommandFailed`), `AgentRole`.
- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) —
  `RuntimeAdapter` interface, `AgentRunHandle`, `AgentStartParams`.
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — Selectors
  (`getActivePlannerRun`, `getActiveAgentRun`, `isAgentRunningForWorkItem`,
  `getWorkItemWithRevision`), `EngineState`.
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `WorkProviderWriter`, `RevisionProviderWriter` interfaces.

## References

- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) —
  `RuntimeAdapter` interface, `AgentRunHandle`, `AgentStartParams`.
- [domain-model.md](./domain-model.md) — Domain commands, domain events, agent role contracts.
