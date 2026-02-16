---
title: Architecture v2 — Migration Plan
version: 0.1.0
last_updated: 2026-02-16
status: draft
---

# Architecture v2 — Migration Plan

Sequenced incremental migration steps taking the spec corpus from its current state to the target
architecture defined in 002-architecture.md. Each step is independently verifiable. The system
(specs, types, tests) remains consistent after each step.

## Agent instructions

### File layout

All existing specs live in `docs/specs/decree/`. New specs created by this plan go in the same
directory. The v2 planning documents (`001-plan.md`, `002-architecture.md`, this file) live in
`docs/specs/decree/v2/`.

### Process per step

1. Read every file listed in the step's **Read first** section.
2. For REWORK steps: read the existing spec being reworked (listed under "Affected specs") to
   understand the current state you are changing.
3. Invoke the `/spec-writing` skill, then use the `/doc-coauthoring` skill to write or update the
   spec.
4. Replace content in place — do not reprint entire sections when editing.
5. Verify per the step's criteria.
6. Check the box in this file.

Steps marked "parallel" within a group have no dependencies on each other and can be worked
concurrently.

### Spec conventions

- Specs use YAML frontmatter: `title`, `version` (semver), `last_updated` (ISO date), `status`
  (`draft` | `approved` | `deprecated`).
- New specs start at `version: 0.1.0`, `status: draft`.
- Follow the format and depth of existing specs in `docs/specs/decree/` — read one or two as
  examples before writing.
- See `CLAUDE.md` for all code style and project conventions.

### Key documents

| Document                                   | What it contains                                                  |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `docs/specs/decree/v2/001-plan.md`         | 22 decisions and spec catalog — the "why" behind the architecture |
| `docs/specs/decree/v2/002-architecture.md` | Target architecture — domain model, components, contracts         |
| `CLAUDE.md`                                | Project conventions, code style, testing patterns                 |

---

## Step 1: State store spec

Foundation for all other components. Defines the canonical engine state shape, state update
functions, and selectors. References domain types already defined in 002-architecture.md — does not
redefine them.

- [x] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model, State Store, State Updates,
  Selectors, Agent Run Lifecycle.

**What changes:**

- Define `EngineState` shape — `workItems`, `revisions`, `specs`, `agentRuns`, `errors`,
  `lastPlannedSHAs` maps.
- Define per-role `AgentRun` variants (`PlannerRun`, `ImplementorRun`, `ReviewerRun`) and the
  `AgentRunStatus` transition table.
- Define `ErrorEntry` and the bounded error list.
- Define `applyStateUpdate` dispatch function and per-event update functions. Specify which events
  produce state changes and which are handled only by handlers (e.g. `UserRequestedImplementorRun` →
  no state update).
- Define selector catalog: `getWorkItemsByStatus`, `getActiveAgentRun`, `getActivePlannerRun`,
  `isAgentRunningForWorkItem`, `getRevisionsByPipelineStatus`, `getWorkItemWithRevision`, plus any
  others needed by handlers and TUI.
- Define Zustand vanilla store creation (`createStore`).

**Affected specs:** None (new spec).

**Depends on:** Nothing — references 002-architecture.md domain types only.

**Verification:** Spec is internally consistent. All `EngineState` fields from 002-architecture.md
are covered. Every event type in the `EngineEvent` union has a corresponding update function (or
explicit no-op). Selectors cover all read patterns referenced by the handler catalog in
002-architecture.md.

**Spec impact:**

| Spec                                  | Action |
| ------------------------------------- | ------ |
| `control-plane-engine-state-store.md` | NEW    |

---

## Step 2: Provider interfaces and GitHub provider spec

Defines the five provider interfaces (3 readers, 2 writers) and the GitHub implementation that maps
GitHub API types to domain types at the boundary.

- [x] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model (all types), Providers (Read
  Interfaces, Write Interfaces, Read/Write Enforcement, GitHub Implementation).

**What changes:**

- Define `WorkProviderReader`, `WorkProviderWriter`, `RevisionProviderReader`,
  `RevisionProviderWriter`, `SpecProviderReader` interfaces with full method signatures.
- Define `createGitHubProvider(config)` factory returning the five interface objects.
- Specify GitHub API → domain type mapping for each method (issue → `WorkItem`, PR → `Revision`,
  tree entry → `Spec`).
- Specify status label parsing (GitHub labels → `WorkItemStatus`), priority/complexity label
  parsing, closing-keyword matching for revision → work item linkage, pipeline status derivation
  from check suites.
- Specify `createFromPatch` idempotency behavior (update existing revision if one exists for the
  work item).
- Specify provider-internal retry strategy for transient failures (backoff parameters, retryable
  status codes).
- Define `RevisionFile` type for on-demand detail fetch.

**Affected specs:** None (new spec).

**Depends on:** Step 1 (references `WorkItem`, `Revision`, `Spec` domain types and `EngineState` for
context on how providers feed the store).

**Verification:** Every reader method returns domain types, not GitHub types. Every writer method
accepts domain-level parameters. The five interfaces match 002-architecture.md exactly.
`createGitHubProvider` return shape matches the wiring shown in `createEngine`.

**Spec impact:**

| Spec                                      | Action |
| ----------------------------------------- | ------ |
| `control-plane-engine-github-provider.md` | NEW    |

---

## Step 3: Pollers (parallel)

Rework the three poller specs to implement provider reader interfaces, diff against the canonical
state store, and enqueue domain events. These three can be done in parallel — they are independent.

### Step 3a: WorkItem poller

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, WorkItem (domain type).
- `docs/specs/decree/control-plane-engine-issue-poller.md` — current spec being reworked.
- `docs/specs/decree/state-store.md` (from step 1) — `EngineState.workItems`, selectors.
- `docs/specs/decree/github-provider.md` (from step 2) — `WorkProviderReader` interface.

**What changes:**

- Rename IssuePoller → WorkItemPoller throughout.
- Replace `IssueSnapshotEntry` / `IssuePollerSnapshot` with store-based diffing — poller calls
  `reader.listWorkItems()` and compares against `getState().workItems`.
- Replace `onIssueStatusChanged` / `onIssueRemoved` callbacks with `enqueue(WorkItemChanged {...})`.
- Remove `updateEntry()` method (engine core no longer mutates poller snapshot).
- Status parsing moves to the provider reader — the poller receives normalized `WorkItem` entities.
- Retain initial poll behavior (immediate first poll, `oldStatus: null` for new items).

**Affected specs:** `control-plane-engine-issue-poller.md`.

**Depends on:** Step 1 (state store for diffing), Step 2 (WorkProviderReader interface).

**Verification:** Poller config accepts
`{ reader: WorkProviderReader, getState, enqueue, interval }`. All emitted events are
`WorkItemChanged`. No direct GitHub types in the spec.

**Spec impact:**

| Spec                                   | Action |
| -------------------------------------- | ------ |
| `control-plane-engine-issue-poller.md` | REWORK |

### Step 3b: Revision poller

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, Revision (domain type),
  RevisionChanged event.
- `docs/specs/decree/control-plane-engine-pr-poller.md` — current spec being reworked.
- `docs/specs/decree/state-store.md` (from step 1) — `EngineState.revisions`, selectors.
- `docs/specs/decree/github-provider.md` (from step 2) — `RevisionProviderReader` interface.

**What changes:**

- Rename PRPoller → RevisionPoller throughout.
- Replace `PRSnapshotEntry` / `PRPollerSnapshot` with store-based diffing — poller calls
  `reader.listRevisions()` and compares against `getState().revisions`.
- Replace `onCIStatusChanged` / `onPRDetected` / `onPRRemoved` callbacks with
  `enqueue(RevisionChanged {...})`.
- `prLinked` event eliminated — work item linkage is a property of `Revision.workItemID`, detected
  by the provider reader.
- CI status is a property of `Revision.pipeline`, not a separate event type.
- CI skip optimization may remain as an internal detail of the provider reader.
- Retain initial poll behavior.

**Affected specs:** `control-plane-engine-pr-poller.md`.

**Depends on:** Step 1 (state store for diffing), Step 2 (RevisionProviderReader interface).

**Verification:** Poller config accepts
`{ reader: RevisionProviderReader, getState, enqueue, interval }`. All emitted events are
`RevisionChanged`. No `prLinked` or `ciStatusChanged` events.

**Spec impact:**

| Spec                                | Action |
| ----------------------------------- | ------ |
| `control-plane-engine-pr-poller.md` | REWORK |

### Step 3c: Spec poller

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, Spec (domain type), SpecChanged
  event.
- `docs/specs/decree/control-plane-engine-spec-poller.md` — current spec being reworked.
- `docs/specs/decree/state-store.md` (from step 1) — `EngineState.specs`, `lastPlannedSHAs`.
- `docs/specs/decree/github-provider.md` (from step 2) — `SpecProviderReader` interface.

**What changes:**

- Replace batch return model (`SpecPollerBatchResult`) with per-file `SpecChanged` event enqueue.
- Replace internal snapshot with store-based diffing — diffs against `getState().specs`.
- Remove `initialSnapshot` seeding from Planner Cache — `lastPlannedSHAs` in the state store
  replaces it.
- Remove `getSnapshot()` method (engine core no longer reads poller snapshot).
- Tree SHA optimization may remain as an internal detail of the SpecProviderReader.
- Retain `commitSHA` in `SpecChanged` events.

**Affected specs:** `control-plane-engine-spec-poller.md`.

**Depends on:** Step 1 (state store for diffing), Step 2 (SpecProviderReader interface).

**Verification:** Poller config accepts
`{ reader: SpecProviderReader, getState, enqueue, interval }`. All emitted events are `SpecChanged`.
No batch result type. No snapshot seeding.

**Spec impact:**

| Spec                                  | Action |
| ------------------------------------- | ------ |
| `control-plane-engine-spec-poller.md` | REWORK |

---

## Step 4: Handlers spec

Defines the handler catalog — each handler's triggers, emitted commands, edge cases, and guard
conditions. Handlers are pure functions: `(event, state) → commands[]`.

- [ ] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Handlers (Shape, Wiring, Catalog), Domain
  Events, Domain Commands, Agent Role Contracts, Recovery.
- `docs/specs/decree/state-store.md` (from step 1) — selectors used by handlers.
- `docs/specs/decree/v2/001-plan.md` — decisions 8, 9, 11, 12 (event flow, sequential processing,
  handler wiring, recovery via pipeline).

**What changes:**

- Define the handler shape and wiring model (`createHandlers(): Handler[]`).
- Specify each handler in the catalog:
  - `handlePlanning` — reacts to `SpecChanged` (approved, blobSHA differs from `lastPlannedSHAs`)
    and `PlannerCompleted`. Emits `RequestPlannerRun`, `ApplyPlannerResult`.
  - `handleReadiness` — reacts to `WorkItemChanged` (to `pending`). Promotes to `ready` when
    `blockedBy` is empty.
  - `handleImplementation` — reacts to `WorkItemChanged` (to `ready`) and `ImplementorCompleted`.
    Emits `RequestImplementorRun`, `ApplyImplementorResult`.
  - `handleReview` — reacts to `RevisionChanged` (pipeline success) and `ReviewerCompleted`. Emits
    `RequestReviewerRun`, `ApplyReviewerResult`.
  - `handleDependencyResolution` — reacts to `WorkItemChanged` (to terminal status). Promotes
    pending items whose blockers are all completed.
  - `handleOrphanedWorkItem` — reacts to `WorkItemChanged` (in-progress, no active run). Emits
    `TransitionWorkItemStatus(pending)`.
  - `handleUserDispatch` — reacts to `UserRequestedImplementorRun`, `UserCancelledRun`,
    `UserTransitionedStatus`. Emits corresponding commands.
- Define the independence invariant — commands from one handler cycle cannot depend on effects of
  other commands in the same cycle.
- Define handler ordering invariants (or lack thereof — order does not affect correctness).

**Affected specs:** None (new spec).

**Depends on:** Step 1 (selectors for state queries), 002-architecture.md (events, commands).

**Verification:** Every handler in the 002-architecture.md catalog table is specified. Every
`EngineEvent` type is addressed by at least one handler (or explicitly documented as having no
handler). Every emitted command exists in the `EngineCommand` union. Handler purity is stated as an
invariant.

**Spec impact:**

| Spec                               | Action |
| ---------------------------------- | ------ |
| `control-plane-engine-handlers.md` | NEW    |

---

## Step 5: CommandExecutor spec

Defines the broker boundary — the single path for all external mutations. Covers the execution
pipeline, concurrency guards, policy gate, command translation, compound command execution, and
error handling.

- [ ] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: CommandExecutor (Pipeline, Concurrency
  Guards, Policy Gate, Command Translation), Domain Commands, Error Handling, Runtime Adapter
  (Interface).
- `docs/specs/decree/state-store.md` (from step 1) — selectors for concurrency checks.
- `docs/specs/decree/github-provider.md` (from step 2) — provider writer interfaces.
- `docs/specs/decree/handlers.md` (from step 4) — which commands handlers emit.
- `docs/specs/decree/v2/001-plan.md` — decisions 13, 14, 15 (broker boundary, concurrency
  enforcement, policy as boolean gate).

**What changes:**

- Define `createCommandExecutor(deps)` with its dependency injection shape (`workItemWriter`,
  `revisionWriter`, `runtimeAdapters`, `policy`, `getState`, `enqueue`).
- Define the execution pipeline: receive command → check concurrency guards → consult policy →
  translate → call provider → emit result events.
- Define concurrency guard rules (one planner at a time, one agent per work item).
- Define `Policy` function type: `(command, state) → { allowed, reason }`.
- Define command translation table — every `EngineCommand` mapped to its provider operations and
  result events.
- Define compound command execution for `ApplyPlannerResult` (tempID resolution, sequenced creates),
  `ApplyImplementorResult` (outcome-dependent operations), `ApplyReviewerResult` (verdict-dependent
  operations).
- Define `startAgentAsync` lifecycle — `*Requested` event on dispatch, async monitor for `*Started`
  / `*Completed` / `*Failed`.
- Define `branchName` generation for implementor runs.
- Define session resolution for cancel commands.
- Define error handling — `CommandRejected` vs `CommandFailed` semantics.

**Affected specs:** None (new spec).

**Depends on:** Step 1 (selectors for concurrency checks), Step 2 (provider writer interfaces), Step
4 (verifying command coverage matches handler emissions), 002-architecture.md (RuntimeAdapter
interface).

**Verification:** Every command in the `EngineCommand` union has a translation entry. Concurrency
guard rules match 002-architecture.md. The `CommandRejected` / `CommandFailed` event contracts match
the error handling section.

**Spec impact:**

| Spec                                       | Action |
| ------------------------------------------ | ------ |
| `control-plane-engine-command-executor.md` | NEW    |

---

## Step 6: Runtime adapter

Reworks the Agent Manager spec into a RuntimeAdapter implementation spec. The interface is defined
in 002-architecture.md; this spec covers the concrete implementation.

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Runtime Adapter (Interface, Mutation
  Boundary, Worktree Management, Agent Run Lifecycle), Agent Results, Agent Role Contracts (Shared
  Patterns).
- `docs/specs/decree/control-plane-engine-agent-manager.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-context-precomputation.md` — context assembly being
  absorbed (DELETE spec — understand what it covers so nothing is lost).
- `docs/specs/decree/command-executor.md` (from step 5) — `startAgentAsync` lifecycle.
- `docs/specs/decree/v2/001-plan.md` — decisions 16, 19 (artifact-based interface, sandbox
  readiness).

**What changes:**

- Replace the `QueryFactory` / Agent Manager model with `RuntimeAdapter` interface implementation.
- Define `createClaudeAdapter(config)` — the local Claude SDK runtime adapter.
- Specify worktree lifecycle management (create, checkout branch, cleanup) as an adapter concern.
- Specify agent definition loading from `.claude/agents/*.md` as an adapter concern.
- Specify context assembly — how the adapter resolves `AgentStartParams` (minimal identifiers) into
  the full context each agent needs (spec content, work item body, revision files, diffs).
- Specify structured output parsing — how the adapter validates agent output against per-role JSON
  schemas and produces `PlannerResult` / `ImplementorResult` / `ReviewerResult`.
- Specify `AgentRunHandle` — `output` stream (live logs) and `result` promise.
- Specify programmatic hooks (Bash validator) as adapter configuration.
- Specify the mutation boundary enforcement — agents produce artifacts only, no GitHub operations.
- Retain `settingSources: []` workaround and SDK session configuration details.

**Affected specs:** `control-plane-engine-agent-manager.md`.

**Depends on:** Step 5 (CommandExecutor calls `startAgentAsync` which calls the adapter),
002-architecture.md (RuntimeAdapter interface, AgentStartParams, AgentRunHandle).

**Verification:** Adapter implements the `RuntimeAdapter` interface exactly. `startAgent` returns
`AgentRunHandle`. Context assembly covers all three roles. Structured output schemas match the
`AgentResult` union in 002-architecture.md. No provider writes in the adapter.

**Spec impact:**

| Spec                                    | Action |
| --------------------------------------- | ------ |
| `control-plane-engine-agent-manager.md` | REWORK |

---

## Step 7: Agent specs (parallel)

Rework the three agent specs for structured artifact output and no direct GitHub operations. These
can be done in parallel.

### Step 7a: Planner agent

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Planner),
  PlannerResult, PlannedWorkItem, AgentStartParams (PlannerStartParams).
- `docs/specs/decree/agent-planner.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-agent-manager.md` (reworked in step 6) — context assembly
  for planner.

**What changes:**

- Replace `PlannerStructuredOutput` with `PlannerResult { create, close, update }` using `tempID`
  references for dependency ordering.
- Remove all `gh.sh` / `gh issue create` usage — the planner produces structured output only.
- Update input description — context is provided by the runtime adapter (spec content, diffs,
  existing work items), not pre-computed by the engine.
- Retain decomposition phases and idempotency logic as agent behavior.
- Update pre-planning gates to reference `WorkItem` entities with domain statuses instead of GitHub
  label queries.

**Affected specs:** `agent-planner.md`.

**Depends on:** Step 6 (runtime adapter provides context), 002-architecture.md (`PlannerResult`).

**Verification:** Output schema matches `PlannerResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. Input description references `PlannerStartParams`.

**Spec impact:**

| Spec               | Action |
| ------------------ | ------ |
| `agent-planner.md` | REWORK |

### Step 7b: Implementor agent

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Implementor),
  ImplementorResult, AgentStartParams (ImplementorStartParams).
- `docs/specs/decree/agent-implementor.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-agent-manager.md` (reworked in step 6) — context assembly
  for implementor, worktree management.

**What changes:**

- Replace completion output with `ImplementorResult { outcome, patch, summary }` — three-way outcome
  (`completed`, `blocked`, `validation-failure`).
- Remove all `gh.sh` usage for PR creation, status label changes, blocker comments.
- Agent produces a patch artifact instead of pushing a branch and opening a PR.
- Update input description — context provided by runtime adapter.
- Blocker information moves into `ImplementorResult.summary` instead of GitHub issue comments.
- Status transitions (`pending → in-progress`, etc.) are no longer performed by the agent.

**Affected specs:** `agent-implementor.md`.

**Depends on:** Step 6 (runtime adapter provides context), 002-architecture.md
(`ImplementorResult`).

**Verification:** Output schema matches `ImplementorResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. No direct status transitions.

**Spec impact:**

| Spec                   | Action |
| ---------------------- | ------ |
| `agent-implementor.md` | REWORK |

### Step 7c: Reviewer agent

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Reviewer),
  ReviewerResult, AgentReview, AgentStartParams (ReviewerStartParams).
- `docs/specs/decree/agent-reviewer.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-agent-manager.md` (reworked in step 6) — context assembly
  for reviewer.

**What changes:**

- Replace review posting (GitHub PR review via `gh.sh`) with
  `ReviewerResult { review: AgentReview }` — structured verdict with `approve` / `needs-changes`,
  summary, and line comments.
- Remove all `gh.sh` usage for review submission and label changes.
- Update input description — context provided by runtime adapter (revision diff, work item body,
  prior reviews).
- Retain the 6-step review checklist as agent behavior.
- Status transitions (`review → approved` / `needs-refinement`) no longer performed by agent.

**Affected specs:** `agent-reviewer.md`.

**Depends on:** Step 6 (runtime adapter provides context), 002-architecture.md (`ReviewerResult`,
`AgentReview`).

**Verification:** Output schema matches `ReviewerResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. No direct status transitions or review posting.

**Spec impact:**

| Spec                | Action |
| ------------------- | ------ |
| `agent-reviewer.md` | REWORK |

---

## Step 8: Engine spec

Major rework of the engine spec to reflect the new processing loop, event queue, component wiring,
and public interface. This is the integration spec — it defines how all components connect.

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Component Architecture, Engine Core (Event
  Processing Loop, Event Queue), TUI Contract, all component sections for wiring context.
- `docs/specs/decree/control-plane-engine.md` — current spec being reworked.
- All specs from steps 1–7 — the engine spec wires everything together and must reference each
  component spec.

**What changes:**

- Replace three-layer architecture (Pollers / Engine Core / Interfaces) with the v2 component
  architecture: EventQueue + ProcessingLoop + StateStore + Handlers + CommandExecutor + Providers +
  RuntimeAdapters.
- Define `createEngine(config)` wiring — how provider factory, executor, pollers, handlers, and
  store are assembled.
- Define `Engine` public interface: `start()`, `stop()`, `enqueue()`, `getState()`, `subscribe()`,
  `getWorkItemBody()`, `getRevisionFiles()`, `getAgentStream()`, `refresh()`.
- Define `processEvent` loop — sequential processing, state update → handlers → command execution.
- Define event queue semantics — FIFO, commands produce new events appended to queue.
- Define shutdown invariant — cancel active runs, drain monitors, stop pollers.
- Remove `GitHubClient` monolith — replaced by provider factory.
- Remove dispatch tier classification — replaced by handlers.
- Remove planner deferred buffer — replaced by `lastPlannedSHAs` in state store.
- Remove dedicated recovery section — replaced by `handleOrphanedWorkItem`.
- Update event/command unions to reference 002-architecture.md types.
- Update configuration structure for provider config and runtime adapter config.
- Remove `send(command)` from engine interface — TUI enqueues events, not commands.

**Affected specs:** `control-plane-engine.md`.

**Depends on:** Steps 1–7 (all component specs must be written/reworked first).

**Verification:** Engine wiring references all component specs. `createEngine` config shape matches
002-architecture.md. Processing loop pseudocode matches 002-architecture.md. Public interface
matches 002-architecture.md. No references to removed concepts (GitHubClient, dispatch tiers,
planner deferred buffer, dedicated recovery).

**Spec impact:**

| Spec                      | Action |
| ------------------------- | ------ |
| `control-plane-engine.md` | REWORK |

---

## Step 9: TUI spec

Rework the TUI to be a thin projection of engine state. Replace the parallel Task model with direct
subscription to the canonical engine store.

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: TUI Contract (State Subscription, User
  Actions, Agent Output Streams, Detail Fetches, TUI-Local State, Boundaries).
- `docs/specs/decree/control-plane-tui.md` — current spec being reworked.
- `docs/specs/decree/state-store.md` (from step 1) — selectors the TUI uses.
- `docs/specs/decree/control-plane-engine.md` (reworked in step 8) — engine public interface.

**What changes:**

- Remove the `Task` / `TaskStatus` / `TaskAgent` / `TaskPR` data model — the TUI reads `WorkItem`,
  `Revision`, `AgentRun` directly from engine state via selectors.
- Replace `engine.on()` event subscription with `useStore(engine.store, selector)` Zustand binding.
- Replace `engine.send(command)` with `engine.enqueue(event)` for user actions
  (`UserRequestedImplementorRun`, `UserCancelledRun`, `UserTransitionedStatus`).
- Replace `getIssueDetails(issueNumber)` with `engine.getWorkItemBody(id)`.
- Remove `getCIStatus` / `getPRReviews` detail fetches — CI status is on `Revision.pipeline`, review
  state is on `Revision.reviewID`.
- Simplify `plannerStatus` — derived from `getActivePlannerRun(state)` selector.
- Retain TUI-local state (selected item, scroll, panel focus, modal state) in component state.
- Update keybindings to use `engine.enqueue()`.
- Update startup/shutdown — `engine.start()` / `engine.stop()`.

**Affected specs:** `control-plane-tui.md`.

**Depends on:** Step 1 (selectors), Step 8 (engine public interface).

**Verification:** No `Task` type in the spec. No `engine.on()` or `engine.send()`. All domain state
comes from `useStore` with selectors. User actions are events, not commands. Detail fetches use
engine query methods.

**Spec impact:**

| Spec                   | Action |
| ---------------------- | ------ |
| `control-plane-tui.md` | REWORK |

---

## Step 10: Workflow and contracts

Update workflow specs for v2 terminology, status values, and structured agent output formats. Update
the label setup script for the new label set.

### Step 10a: Workflow spec

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model (WorkItemStatus, Priority,
  Complexity), Agent Role Contracts, Handlers (Catalog).
- `docs/specs/decree/workflow.md` — current spec being reworked.
- `docs/specs/decree/handlers.md` (from step 4) — handler catalog defines dispatch behavior.
- `docs/specs/decree/agent-planner.md`, `docs/specs/decree/agent-implementor.md`,
  `docs/specs/decree/agent-reviewer.md` (reworked in step 7) — agent role descriptions.

**What changes:**

- Update terminology: Issue → WorkItem, PR → Revision, Agent Type → Agent Role.
- Update status values: add `ready` (promoted from `pending` by `handleReadiness`), rename
  `needs-changes` → `needs-refinement`, remove `unblocked` (automatic via
  `handleDependencyResolution`).
- Update complexity values: `simple/complex` → `trivial/low/medium/high`.
- Update status transition table for v2 flow (handler-mediated transitions, reactive status
  changes).
- Update role descriptions — agents produce structured artifacts, no direct GitHub writes.
- Update lifecycle phases to reflect handler-based dispatch and provider abstraction.

**Affected specs:** `workflow.md`.

**Depends on:** Steps 4, 7 (handler catalog and agent specs define the workflow behavior).

**Verification:** All `WorkItemStatus` values match 002-architecture.md. Status transitions are
consistent with the handler catalog. Role descriptions match agent spec changes.

**Spec impact:**

| Spec          | Action |
| ------------- | ------ |
| `workflow.md` | REWORK |

### Step 10b: Workflow contracts

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Results (PlannerResult,
  ImplementorResult, ReviewerResult, AgentReview).
- `docs/specs/decree/workflow-contracts.md` — current spec being reworked.
- `docs/specs/decree/agent-planner.md`, `docs/specs/decree/agent-implementor.md`,
  `docs/specs/decree/agent-reviewer.md` (reworked in step 7) — updated output formats.

**What changes:**

- Replace `PlannerStructuredOutput` with `PlannerResult` (from 002-architecture.md).
- Replace Implementor markdown completion output with `ImplementorResult`.
- Replace Reviewer markdown review templates with `ReviewerResult` / `AgentReview`.
- Update or remove Blocker Comment Format — blocker info is now in `ImplementorResult.summary`.
- Update or remove PR Review Approval/Rejection Templates — absorbed into `AgentReview` structure.
- Retain Task Issue Template if still used for `PlannedWorkItem.body` formatting.
- Retain Scope Enforcement Rules as agent behavior contract.

**Affected specs:** `workflow-contracts.md`.

**Depends on:** Step 7 (agent specs define the new output formats).

**Verification:** All output formats match the `AgentResult` types in 002-architecture.md. No
references to `gh.sh` or direct GitHub operations in output templates.

**Spec impact:**

| Spec                    | Action |
| ----------------------- | ------ |
| `workflow-contracts.md` | REWORK |

### Step 10c: Label setup script

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model (WorkItemStatus, Priority,
  Complexity).
- `docs/specs/decree/script-label-setup.md` — current spec being reworked.
- `docs/specs/decree/workflow.md` (reworked in step 10a) — label taxonomy.

**What changes:**

- Add `status:ready` label.
- Remove `status:unblocked` label (if it existed — `handleDependencyResolution` auto-promotes).
- Rename `status:needs-changes` → `status:needs-refinement`.
- Replace `complexity:simple` / `complexity:complex` with `complexity:trivial` / `complexity:low` /
  `complexity:medium` / `complexity:high`.
- Update label descriptions and colors as needed.

**Affected specs:** `script-label-setup.md`.

**Depends on:** Step 10a (workflow spec defines the label taxonomy).

**Verification:** Label set matches `WorkItemStatus`, `Priority`, and `Complexity` enums from
002-architecture.md. Script remains idempotent.

**Spec impact:**

| Spec                    | Action |
| ----------------------- | ------ |
| `script-label-setup.md` | REWORK |

---

## Step 11: Top-level overview

Update the control plane overview spec for the v2 architecture. This is the last REWORK — it
summarizes all component changes.

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — full document (this is the overview spec).
- `docs/specs/decree/control-plane.md` — current spec being reworked.
- All component specs from steps 1–10 — overview must be consistent with all of them.

**What changes:**

- Replace dispatch tier table with handler-based dispatch model.
- Replace `GitHubClient` monolith with provider abstraction (5 interfaces, `createGitHubProvider`).
- Replace direct SDK agent invocation with RuntimeAdapter abstraction.
- Replace worktree strategy section — worktrees are a runtime adapter concern.
- Replace recovery section — `handleOrphanedWorkItem` via normal event processing.
- Add: EventQueue, CommandExecutor (broker boundary), Policy gate, sequential processing, provider
  read/write enforcement.
- Update technology references if needed.

**Affected specs:** `control-plane.md`.

**Depends on:** Steps 1–10 (all component specs finalized).

**Verification:** Overview is consistent with all component specs. No references to removed
concepts. Component list matches the actual spec set.

**Spec impact:**

| Spec               | Action |
| ------------------ | ------ |
| `control-plane.md` | REWORK |

---

## Step 12: Deprecate replaced specs

Mark the three DELETE specs as deprecated. Their replacements are now in place:

- `control-plane-engine-recovery.md` → replaced by `handleOrphanedWorkItem` in handlers spec
  (step 4) and recovery section in 002-architecture.md.
- `control-plane-engine-planner-cache.md` → replaced by `lastPlannedSHAs` in state store spec
  (step 1) and `handlePlanning` re-dispatch logic in handlers spec (step 4).
- `control-plane-engine-context-precomputation.md` → replaced by runtime adapter context assembly
  (step 6).

- [ ] Deprecate specs

**Read first:**

- `docs/specs/decree/control-plane-engine-recovery.md` — spec being deprecated.
- `docs/specs/decree/control-plane-engine-planner-cache.md` — spec being deprecated.
- `docs/specs/decree/control-plane-engine-context-precomputation.md` — spec being deprecated.
- `docs/specs/decree/handlers.md` (from step 4) — `handleOrphanedWorkItem` replaces recovery.
- `docs/specs/decree/state-store.md` (from step 1) — `lastPlannedSHAs` replaces planner cache.
- `docs/specs/decree/control-plane-engine-agent-manager.md` (reworked in step 6) — context assembly
  replaces context precomputation.

**What changes:**

- Update frontmatter `status: deprecated` on each spec.
- Add a deprecation notice at the top of each pointing to the replacement.

**Affected specs:** `control-plane-engine-recovery.md`, `control-plane-engine-planner-cache.md`,
`control-plane-engine-context-precomputation.md`.

**Depends on:** Steps 1, 4, 6 (replacements must be in place).

**Verification:** Each deprecated spec points to its replacement. No other spec references the
deprecated specs without noting the replacement.

**Spec impact:**

| Spec                                             | Action     |
| ------------------------------------------------ | ---------- |
| `control-plane-engine-recovery.md`               | DEPRECATED |
| `control-plane-engine-planner-cache.md`          | DEPRECATED |
| `control-plane-engine-context-precomputation.md` | DEPRECATED |

---

## Dependency graph

```
Step 1 (state store)
  │
  ├──► Step 2 (GitHub provider)
  │      │
  │      ├──► Step 3a (WorkItem poller)  ─┐
  │      ├──► Step 3b (Revision poller)   ├─► Step 8 (engine) ──► Step 9 (TUI)
  │      └──► Step 3c (Spec poller)      ─┘        │
  │                                                 │
  ├──► Step 4 (handlers) ─────────────────────────►─┤
  │      │                                          │
  │      └──► Step 5 (CommandExecutor) ────────────►┤
  │             │                                   │
  │             └──► Step 6 (runtime adapter)──────►┤
  │                    │                            │
  │                    ├──► Step 7a (planner)  ─────┤
  │                    ├──► Step 7b (implementor) ──┤
  │                    └──► Step 7c (reviewer) ─────┘
  │
  ├──► Step 10a (workflow) ──► Step 10c (label setup)
  ├──► Step 10b (contracts)
  │
  ├──► Step 11 (overview) — depends on all above
  └──► Step 12 (deprecations) — depends on steps 1, 4, 6
```

## Summary

| Step | Spec                                             | Action     |
| ---- | ------------------------------------------------ | ---------- |
| 1    | `control-plane-engine-state-store.md`            | NEW        |
| 2    | `control-plane-engine-github-provider.md`        | NEW        |
| 3a   | `control-plane-engine-issue-poller.md`           | REWORK     |
| 3b   | `control-plane-engine-pr-poller.md`              | REWORK     |
| 3c   | `control-plane-engine-spec-poller.md`            | REWORK     |
| 4    | `control-plane-engine-handlers.md`               | NEW        |
| 5    | `control-plane-engine-command-executor.md`       | NEW        |
| 6    | `control-plane-engine-agent-manager.md`          | REWORK     |
| 7a   | `agent-planner.md`                               | REWORK     |
| 7b   | `agent-implementor.md`                           | REWORK     |
| 7c   | `agent-reviewer.md`                              | REWORK     |
| 8    | `control-plane-engine.md`                        | REWORK     |
| 9    | `control-plane-tui.md`                           | REWORK     |
| 10a  | `workflow.md`                                    | REWORK     |
| 10b  | `workflow-contracts.md`                          | REWORK     |
| 10c  | `script-label-setup.md`                          | REWORK     |
| 11   | `control-plane.md`                               | REWORK     |
| 12   | `control-plane-engine-recovery.md`               | DEPRECATED |
| 12   | `control-plane-engine-planner-cache.md`          | DEPRECATED |
| 12   | `control-plane-engine-context-precomputation.md` | DEPRECATED |
