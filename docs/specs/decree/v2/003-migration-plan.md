---
title: Architecture v2 — Migration Plan
version: 0.3.0
last_updated: 2026-02-18
status: draft
---

# Architecture v2 — Migration Plan

Sequenced incremental migration steps taking the spec corpus from its current state to the target
architecture defined in 002-architecture.md. Each step is independently verifiable. The system
(specs, types, tests) remains consistent after each step.

This plan sequences **spec work**. Implementation follows each spec step — see "Implementation
phasing" below for how module implementation and engine integration relate.

## Agent instructions

### File layout

All existing specs live in `docs/specs/decree/`. New specs created by this plan go in the same
directory. The v2 planning documents (`001-plan.md`, `002-architecture.md`, this file) live in
`docs/specs/decree/v2/`.

### Process per step

1. Consult the **Implementation phasing** section below to confirm you are in the correct track.
   Steps within the cutover track (10–12) must not be started until the engine track (7–9) is
   complete.
2. Read every file listed in the step's **Read first** section.
3. For REWORK steps: read the existing spec being reworked (listed under "Affected specs") to
   understand the current state you are changing.
4. Invoke the `/spec-writing` skill, then use the `/doc-coauthoring` skill to write or update the
   spec.
5. Replace content in place — do not reprint entire sections when editing.
6. Verify per the step's criteria.
7. Check the box in this file.

Steps marked "parallel" within a group have no dependencies on each other and can be worked
concurrently.

### Spec conventions

- Specs use YAML frontmatter: `title`, `version` (semver), `last_updated` (ISO date), `status`
  (`draft` | `approved` | `deprecated`).
- New specs start at `version: 0.1.0`, `status: draft`.
- Follow the format and depth of existing specs in `docs/specs/decree/` — read one or two as
  examples before writing.
- See `CLAUDE.md` for all code style and project conventions.

### Implementation phasing

Implementation follows three tracks, reflected in the step numbering:

**Usability invariant.** The v1 control plane remains the running, buildable system until the
cutover. There is no intermediate state where some components are v2 and others are v1 at runtime.
V2 modules are developed and unit-tested in isolation; the v1 engine, TUI, agents, and workflow
continue to function on `main` throughout.

**Module track (Steps 1–6) — COMPLETE.** Each step produced a self-contained v2 module with clean
boundaries — state store, provider, pollers, handlers, command executor, runtime adapter. These
modules were implemented and unit-tested independently. They do not depend on the v1 engine; they
are new code with new interfaces.

**Engine track (Steps 7–9).** Specs that describe v2 engine and TUI behavior without affecting v1
agents at runtime. The engine spec (Step 7) references `002-architecture.md` for agent role
contracts (`AgentStartParams`, `AgentResult` types) instead of requiring the reworked agent specs
from Step 10. The TUI spec (Step 8) depends on the v2 engine, not on agents. Deprecations (Step 9)
are frontmatter-only changes to specs already replaced by Steps 1, 4, and 6b. All engine track specs
can be written ahead of the cutover. Engine and TUI code can be partially implemented (new files,
unit-tested in isolation) but cannot run as a system until the cutover.

**Cutover track (Steps 10–12).** Specs that v1 agents depend on at runtime — agent behavior
(`agent-planner.md`, `agent-implementor.md`, `agent-reviewer.md`), workflow protocol
(`workflow.md`), output contracts (`workflow-contracts.md`), and label names
(`script-label-setup.md`). Spec writing for this track is deferred until the engine track specs are
complete.

**Cutover implementation scope.** Once all specs are written (Steps 7–12), implementation of Steps
7, 8, 10, and 11 happens as a **single cutover** — the v2 engine, v2 TUI, v2 agent contracts, and v2
workflow all ship together. Step 9 is frontmatter-only (no code). Step 12 (overview) is spec-only
(no code). The cutover replaces `create-engine.ts` wholesale, adapts the TUI to the v2 engine
interface, and switches agents to structured artifact output. No intermediate state where v1 agents
run against v2 contracts or the v2 engine runs with the v1 TUI.

This model exists because the v1 pollers are deeply coupled to the engine's internal dispatch,
recovery, and planner-cache patterns. They cannot be swapped individually — attempting to wire a v2
poller into the v1 engine requires rewriting every consumer of the v1 poller's snapshot/callback
API, which cascades into a full engine rewrite. The v2 TUI depends on the v2 engine interface
(`engine.store` for Zustand binding, `engine.enqueue` for user actions, domain types) which is
incompatible with the v1 interface. The clean cut is to implement all v2 modules independently
(module track), spec everything (engine + cutover tracks), then replace engine, TUI, agents, and
workflow together.

**V1 module deletions** — old poller files, the dispatch module, recovery module, and planner-cache
module — happen as part of the cutover, not as separate tasks.

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

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, WorkItem (domain type).
- `docs/specs/decree/control-plane-engine-issue-poller.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — `EngineState.workItems`,
  selectors.
- `docs/specs/decree/control-plane-engine-github-provider.md` (from step 2) — `WorkProviderReader`
  interface.

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

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, Revision (domain type),
  RevisionChanged event.
- `docs/specs/decree/control-plane-engine-pr-poller.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — `EngineState.revisions`,
  selectors.
- `docs/specs/decree/control-plane-engine-github-provider.md` (from step 2) —
  `RevisionProviderReader` interface.

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

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Pollers, Spec (domain type), SpecChanged
  event.
- `docs/specs/decree/control-plane-engine-spec-poller.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — `EngineState.specs`,
  `lastPlannedSHAs`.
- `docs/specs/decree/control-plane-engine-github-provider.md` (from step 2) — `SpecProviderReader`
  interface.

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

- [x] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Handlers (Shape, Wiring, Catalog), Domain
  Events, Domain Commands, Agent Role Contracts, Recovery.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — selectors used by
  handlers.
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

- [x] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: CommandExecutor (Pipeline, Concurrency
  Guards, Policy Gate, Command Translation), Domain Commands, Error Handling, Runtime Adapter
  (Interface).
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — selectors for concurrency
  checks.
- `docs/specs/decree/control-plane-engine-github-provider.md` (from step 2) — provider writer
  interfaces.
- `docs/specs/decree/control-plane-engine-handlers.md` (from step 4) — which commands handlers emit.
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

## Step 6: Runtime adapter (parallel)

Split into two specs: a core contract spec (implementation-agnostic) and a Claude SDK implementation
spec. These replace `control-plane-engine-agent-manager.md`.

### Step 6a: Runtime adapter core contract

- [x] Write spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Runtime Adapter (Interface, Mutation
  Boundary, Worktree Management, Agent Run Lifecycle), Agent Results, Agent Role Contracts (Shared
  Patterns).
- `docs/specs/decree/control-plane-engine-command-executor.md` (from step 5) — `startAgentAsync`
  lifecycle, temporarily hosted types.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — `EngineState`,
  `lastPlannedSHAs`.
- `docs/specs/decree/control-plane-engine-github-provider.md` (from step 2) — provider reader
  interfaces.

**What changes:**

- Define `RuntimeAdapter` interface with behavioral detail beyond 002-architecture.md.
- Define `AgentRunHandle` shape and behavioral contracts.
- Define `AgentStartParams` per-role discriminated union (permanent type home).
- Define `startAgent` lifecycle contract — abstract sequence any adapter must follow.
- Define `cancelAgent` contract.
- Define execution environment requirements per role.
- Define context assembly data requirements per role (WHAT data, not prompt format).
- Define patch extraction contract for Implementor.
- Define structured output validation contract.
- Define `RuntimeAdapterDeps` — universal dependency interface.
- Define `RuntimeAdapterConfig` — base config type.
- Define `ReviewHistory` types.
- Define type home: `engine/runtime-adapter/types.ts`.

**Affected specs:** None (new spec).

**Depends on:** Step 1 (state store for `EngineState`, `lastPlannedSHAs`), Step 2 (provider reader
interfaces), Step 5 (CommandExecutor's `startAgentAsync` lifecycle).

**Verification:** Contract is implementation-agnostic — no SDK calls, git commands, Zod schemas, or
prompt templates. All types needed by the CommandExecutor are defined. Context data requirements
cover all three roles.

**Spec impact:**

| Spec                                      | Action |
| ----------------------------------------- | ------ |
| `control-plane-engine-runtime-adapter.md` | NEW    |

### Step 6b: Runtime adapter — Claude implementation

- [x] Write spec

**Read first:**

- `docs/specs/decree/control-plane-engine-runtime-adapter.md` (from step 6a) — core contract this
  spec implements.
- `docs/specs/decree/control-plane-engine-agent-manager.md` — current spec being replaced (source
  material for Claude-specific content).
- `docs/specs/decree/control-plane-engine-context-precomputation.md` — context assembly being
  absorbed (DELETE spec — understand what it covers so nothing is lost).
- `docs/specs/decree/v2/001-plan.md` — decisions 16, 19 (artifact-based interface, sandbox
  readiness).

**What changes:**

- Define `createClaudeAdapter(config, deps)` factory — `ClaudeAdapterConfig` extends
  `RuntimeAdapterConfig`.
- Specify SDK session configuration (`query()`, all options).
- Specify agent definition loading from `.claude/agents/*.md` using `gray-matter`.
- Specify Zod schemas for structured output validation.
- Specify git worktree lifecycle (create, `yarn install`, cleanup, `-B` flag rationale).
- Specify patch extraction via `git diff main..HEAD`.
- Specify enriched prompt format templates per role.
- Specify project context injection via `contextPaths`.
- Specify programmatic hooks (`bashValidatorHook`).
- Specify output stream implementation (SDK message stream → plain text).
- Specify duration timeout via `AbortController`.
- Retain `settingSources: []` workaround.

**Affected specs:** None (new spec, replaces `control-plane-engine-agent-manager.md`).

**Depends on:** Step 6a (core contract it implements).

**Verification:** Adapter implements the `RuntimeAdapter` interface exactly. `startAgent` returns
`AgentRunHandle`. Context assembly covers all three roles with prompt format templates. Structured
output Zod schemas match the `AgentResult` union in 002-architecture.md. No provider writes in the
adapter. SDK isolation enforced.

**Spec impact:**

| Spec                                             | Action             |
| ------------------------------------------------ | ------------------ |
| `control-plane-engine-runtime-adapter-claude.md` | NEW                |
| `control-plane-engine-agent-manager.md`          | DELETE (at Step 7) |

---

## Step 7: Engine spec

Major rework of the engine spec to reflect the new processing loop, event queue, component wiring,
and public interface. It defines how all v2 components connect.

This is the **engine track** milestone (see "Implementation phasing" above). Implementation of this
step replaces `create-engine.ts` wholesale with a new engine that wires all v2 modules together. The
v1 engine, its dispatch module, recovery module, planner-cache module, and v1 poller files are
deleted as part of this step's implementation — not beforehand.

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Component Architecture, Engine Core (Event
  Processing Loop, Event Queue), TUI Contract, Agent Role Contracts, Agent Results,
  AgentStartParams, all component sections for wiring context.
- `docs/specs/decree/control-plane-engine.md` — current spec being reworked.
- All specs from steps 1–6 — the engine spec wires all v2 modules together.

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

**Depends on:** Steps 1–6 (all v2 module specs). References `002-architecture.md` for agent role
contracts (`AgentStartParams`, `AgentResult` types) — does NOT depend on agent spec rework (Step
10).

**Verification:** Engine wiring references all component specs. `createEngine` config shape matches
002-architecture.md. Processing loop pseudocode matches 002-architecture.md. Public interface
matches 002-architecture.md. No references to removed concepts (GitHubClient, dispatch tiers,
planner deferred buffer, dedicated recovery).

**Spec impact:**

| Spec                                    | Action |
| --------------------------------------- | ------ |
| `control-plane-engine.md`               | REWORK |
| `control-plane-engine-agent-manager.md` | DELETE |

---

## Step 8: TUI spec

Rework the TUI to be a thin projection of engine state. Replace the parallel Task model with direct
subscription to the canonical engine store.

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: TUI Contract (State Subscription, User
  Actions, Agent Output Streams, Detail Fetches, TUI-Local State, Boundaries).
- `docs/specs/decree/control-plane-tui.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — selectors the TUI uses.
- `docs/specs/decree/control-plane-engine.md` (reworked in step 7) — engine public interface.

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

**Depends on:** Step 1 (selectors), Step 7 (engine public interface).

**Verification:** No `Task` type in the spec. No `engine.on()` or `engine.send()`. All domain state
comes from `useStore` with selectors. User actions are events, not commands. Detail fetches use
engine query methods.

**Spec impact:**

| Spec                   | Action |
| ---------------------- | ------ |
| `control-plane-tui.md` | REWORK |

---

## Step 9: Deprecate replaced specs

Mark the three DELETE specs as deprecated. Their replacements are now in place:

- `control-plane-engine-recovery.md` → replaced by `handleOrphanedWorkItem` in handlers spec
  (step 4) and recovery section in 002-architecture.md.
- `control-plane-engine-planner-cache.md` → replaced by `lastPlannedSHAs` in state store spec
  (step 1) and `handlePlanning` re-dispatch logic in handlers spec (step 4).
- `control-plane-engine-context-precomputation.md` → replaced by runtime adapter context assembly
  (step 6b).

- [x] Deprecate specs

**Read first:**

- `docs/specs/decree/control-plane-engine-recovery.md` — spec being deprecated.
- `docs/specs/decree/control-plane-engine-planner-cache.md` — spec being deprecated.
- `docs/specs/decree/control-plane-engine-context-precomputation.md` — spec being deprecated.
- `docs/specs/decree/control-plane-engine-handlers.md` (from step 4) — `handleOrphanedWorkItem`
  replaces recovery.
- `docs/specs/decree/control-plane-engine-state-store.md` (from step 1) — `lastPlannedSHAs` replaces
  planner cache.
- `docs/specs/decree/control-plane-engine-runtime-adapter-claude.md` (from step 6b) — context
  assembly replaces context precomputation.

**What changes:**

- Update frontmatter `status: deprecated` on each spec.
- Add a deprecation notice at the top of each pointing to the replacement.

**Affected specs:** `control-plane-engine-recovery.md`, `control-plane-engine-planner-cache.md`,
`control-plane-engine-context-precomputation.md`.

**Depends on:** Steps 1, 4, 6b (replacements must be in place).

**Verification:** Each deprecated spec points to its replacement. No other spec references the
deprecated specs without noting the replacement.

**Spec impact:**

| Spec                                             | Action     |
| ------------------------------------------------ | ---------- |
| `control-plane-engine-recovery.md`               | DEPRECATED |
| `control-plane-engine-planner-cache.md`          | DEPRECATED |
| `control-plane-engine-context-precomputation.md` | DEPRECATED |

---

## Step 10: Agent specs (parallel)

Rework the three agent specs for structured artifact output and no direct GitHub operations. These
can be done in parallel.

Spec writing and implementation for this step are deferred to the cutover track — see
"Implementation phasing" above.

### Step 10a: Planner agent

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Planner),
  PlannerResult, PlannedWorkItem, AgentStartParams (PlannerStartParams).
- `docs/specs/decree/agent-planner.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-runtime-adapter-claude.md` (from step 6b) — context
  assembly for planner.

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

**Depends on:** Step 6b (runtime adapter provides context), 002-architecture.md (`PlannerResult`).

**Verification:** Output schema matches `PlannerResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. Input description references `PlannerStartParams`.

**Spec impact:**

| Spec               | Action |
| ------------------ | ------ |
| `agent-planner.md` | REWORK |

### Step 10b: Implementor agent

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Implementor),
  ImplementorResult, AgentStartParams (ImplementorStartParams).
- `docs/specs/decree/agent-implementor.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-runtime-adapter-claude.md` (from step 6b) — context
  assembly for implementor, worktree management.

**What changes:**

- Replace completion output with `ImplementorResult { outcome, patch, summary }` — three-way outcome
  (`completed`, `blocked`, `validation-failure`).
- Remove all `gh.sh` usage for PR creation, status label changes, blocker comments.
- Agent produces a patch artifact instead of pushing a branch and opening a PR.
- Update input description — context provided by runtime adapter.
- Blocker information moves into `ImplementorResult.summary` instead of GitHub issue comments.
- Status transitions (`pending → in-progress`, etc.) are no longer performed by the agent.

**Affected specs:** `agent-implementor.md`.

**Depends on:** Step 6b (runtime adapter provides context), 002-architecture.md
(`ImplementorResult`).

**Verification:** Output schema matches `ImplementorResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. No direct status transitions.

**Spec impact:**

| Spec                   | Action |
| ---------------------- | ------ |
| `agent-implementor.md` | REWORK |

### Step 10c: Reviewer agent

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Role Contracts (Reviewer),
  ReviewerResult, AgentReview, AgentStartParams (ReviewerStartParams).
- `docs/specs/decree/agent-reviewer.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-runtime-adapter-claude.md` (from step 6b) — context
  assembly for reviewer.

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

**Depends on:** Step 6b (runtime adapter provides context), 002-architecture.md (`ReviewerResult`,
`AgentReview`).

**Verification:** Output schema matches `ReviewerResult` from 002-architecture.md. No `gh.sh` or
GitHub CLI usage. No direct status transitions or review posting.

**Spec impact:**

| Spec                | Action |
| ------------------- | ------ |
| `agent-reviewer.md` | REWORK |

---

## Step 11: Workflow and contracts

Update workflow specs for v2 terminology, status values, and structured agent output formats. Update
the label setup script for the new label set.

Spec writing and implementation for this step are deferred to the cutover track — see
"Implementation phasing" above.

### Step 11a: Workflow spec

- [x] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model (WorkItemStatus, Priority,
  Complexity), Agent Role Contracts, Handlers (Catalog).
- `docs/specs/decree/workflow.md` — current spec being reworked.
- `docs/specs/decree/control-plane-engine-handlers.md` (from step 4) — handler catalog defines
  dispatch behavior.
- `docs/specs/decree/agent-planner.md`, `docs/specs/decree/agent-implementor.md`,
  `docs/specs/decree/agent-reviewer.md` (reworked in step 10) — agent role descriptions.

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

**Depends on:** Steps 4, 10 (handler catalog and agent specs define the workflow behavior).

**Verification:** All `WorkItemStatus` values match 002-architecture.md. Status transitions are
consistent with the handler catalog. Role descriptions match agent spec changes.

**Spec impact:**

| Spec          | Action |
| ------------- | ------ |
| `workflow.md` | REWORK |

### Step 11b: Workflow contracts

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Agent Results (PlannerResult,
  ImplementorResult, ReviewerResult, AgentReview).
- `docs/specs/decree/workflow-contracts.md` — current spec being reworked.
- `docs/specs/decree/agent-planner.md`, `docs/specs/decree/agent-implementor.md`,
  `docs/specs/decree/agent-reviewer.md` (reworked in step 10) — updated output formats.

**What changes:**

- Replace `PlannerStructuredOutput` with `PlannerResult` (from 002-architecture.md).
- Replace Implementor markdown completion output with `ImplementorResult`.
- Replace Reviewer markdown review templates with `ReviewerResult` / `AgentReview`.
- Update or remove Blocker Comment Format — blocker info is now in `ImplementorResult.summary`.
- Update or remove PR Review Approval/Rejection Templates — absorbed into `AgentReview` structure.
- Retain Task Issue Template if still used for `PlannedWorkItem.body` formatting.
- Retain Scope Enforcement Rules as agent behavior contract.

**Affected specs:** `workflow-contracts.md`.

**Depends on:** Step 10 (agent specs define the new output formats).

**Verification:** All output formats match the `AgentResult` types in 002-architecture.md. No
references to `gh.sh` or direct GitHub operations in output templates.

**Spec impact:**

| Spec                    | Action |
| ----------------------- | ------ |
| `workflow-contracts.md` | REWORK |

### Step 11c: Label setup script

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — sections: Domain Model (WorkItemStatus, Priority,
  Complexity).
- `docs/specs/decree/script-label-setup.md` — current spec being reworked.
- `docs/specs/decree/workflow.md` (reworked in step 11a) — label taxonomy.

**What changes:**

- Add `status:ready` label.
- Remove `status:unblocked` label (if it existed — `handleDependencyResolution` auto-promotes).
- Rename `status:needs-changes` → `status:needs-refinement`.
- Replace `complexity:simple` / `complexity:complex` with `complexity:trivial` / `complexity:low` /
  `complexity:medium` / `complexity:high`.
- Update label descriptions and colors as needed.

**Affected specs:** `script-label-setup.md`.

**Depends on:** Step 11a (workflow spec defines the label taxonomy).

**Verification:** Label set matches `WorkItemStatus`, `Priority`, and `Complexity` enums from
002-architecture.md. Script remains idempotent.

**Spec impact:**

| Spec                    | Action |
| ----------------------- | ------ |
| `script-label-setup.md` | REWORK |

---

## Step 12: Top-level overview

Update the control plane overview spec for the v2 architecture. This is the last REWORK — it
summarizes all component changes.

Spec writing and implementation for this step are deferred to the cutover track — see
"Implementation phasing" above.

- [ ] Rework spec

**Read first:**

- `docs/specs/decree/v2/002-architecture.md` — full document (this is the overview spec).
- `docs/specs/decree/control-plane.md` — current spec being reworked.
- All component specs from steps 1–11 — overview must be consistent with all of them.

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

**Depends on:** Steps 1–11 (all component specs finalized).

**Verification:** Overview is consistent with all component specs. No references to removed
concepts. Component list matches the actual spec set.

**Spec impact:**

| Spec               | Action |
| ------------------ | ------ |
| `control-plane.md` | REWORK |

---

## Dependency graph

```
Step 1 (state store)
  │
  ├──► Step 2 (GitHub provider)
  │      │
  │      ├──► Step 3a (WorkItem poller)  ─┐
  │      ├──► Step 3b (Revision poller)   ├──────────────────────┐
  │      └──► Step 3c (Spec poller)      ─┘                      │
  │                                                               │
  ├──► Step 4 (handlers) ─────────────────────► Step 7 (engine) ─► Step 8 (TUI)
  │      │                                        │
  │      └──► Step 5 (CommandExecutor) ──────────►┤
  │             │                                  │
  │             └──► Step 6a (runtime core) ─────►┤
  │                    │                           │
  │                    └──► Step 6b (Claude) ────►┘
  │                           │
  │                           ├──► Step 10a (planner)  ─┐
  │                           ├──► Step 10b (impl.)     ├──┐
  │                           └──► Step 10c (reviewer) ─┘  │
  │                                                         │
  │  Step 4 ──► Step 11a (workflow) ◄──────────────────────┤
  │               │                                         │
  │               └──► Step 11c (label setup)               │
  │             Step 11b (contracts) ◄─────────────────────┘
  │
  ├──► Step 9 (deprecations) — depends on steps 1, 4, 6b
  └──► Step 12 (overview) — depends on all above
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
| 6a   | `control-plane-engine-runtime-adapter.md`        | NEW        |
| 6b   | `control-plane-engine-runtime-adapter-claude.md` | NEW        |
| 7    | `control-plane-engine.md`                        | REWORK     |
| 7    | `control-plane-engine-agent-manager.md`          | DELETE     |
| 8    | `control-plane-tui.md`                           | REWORK     |
| 9    | `control-plane-engine-recovery.md`               | DEPRECATED |
| 9    | `control-plane-engine-planner-cache.md`          | DEPRECATED |
| 9    | `control-plane-engine-context-precomputation.md` | DEPRECATED |
| 10a  | `agent-planner.md`                               | REWORK     |
| 10b  | `agent-implementor.md`                           | REWORK     |
| 10c  | `agent-reviewer.md`                              | REWORK     |
| 11a  | `workflow.md`                                    | REWORK     |
| 11b  | `workflow-contracts.md`                          | REWORK     |
| 11c  | `script-label-setup.md`                          | REWORK     |
| 12   | `control-plane.md`                               | REWORK     |
