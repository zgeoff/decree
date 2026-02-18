---
title: Architecture v2 — Plan
version: 0.5.0
last_updated: 2026-02-17
status: draft
---

# Architecture v2 — Plan

This document tracks the architectural redesign of the decree control plane. It captures decisions
made and the phases of work. Once each phase is complete, this document gets cleaned up or retired.

## Phases

- [x] **Phase 1: Architecture spec** — Write the architecture spec capturing the target
      architecture.
- [x] **Phase 2: Migration plan** — Write the migration plan with sequenced incremental refactors.
      Each step identifies: what changes, affected modules, verification criteria, and spec impact
      (new spec / spec becomes redundant / spec needs modification).
- [ ] **Phase 3: Spec-driven migration** — For each migration step: write or rework the affected
      spec, then implement, then mark the step done. Implementation follows three tracks — see
      [003-migration-plan.md: Implementation phasing](./003-migration-plan.md#implementation-phasing)
      for the full breakdown:
  - **Module track (Steps 1–6):** Each step produces a self-contained v2 module that can be
    implemented and unit-tested independently. Modules do not depend on the v1 engine — they are new
    code with new interfaces.
  - **Engine track (Steps 7–9):** Engine, TUI, and deprecation specs. Can be specced and partially
    implemented (new files, unit tests) ahead of the cutover.
  - **Cutover (Steps 7, 8, 10, 11):** The v2 engine, TUI, agent contracts, and workflow ship
    together as a single replacement. The v1 control plane remains the running system until then. No
    intermediate state where v1 and v2 components run together at runtime.

## Decisions

### Domain model and terminology

1. **Domain model.** Three domain concepts:
   - `WorkItem` — normalized from issues/tickets. Carries status, labels, metadata.
   - `Revision` — normalized from PRs/merge requests. Carries pipeline/CI status as a property (not
     a separate entity).
   - `Spec` — lightweight domain concept for spec files. Carries frontmatter status and file
     identity. Not as rich as WorkItem/Revision, but visible to the domain model with its own events
     (`SpecChanged`, `SpecApproved`). Without this, spec handling leaks filesystem details into
     handlers.

2. **Domain-level commands.** Commands are domain concepts (`TransitionWorkItemStatus`,
   `AnnotateRevision`, `RequestAgentRun`), not provider-specific operations. The CommandExecutor
   translates domain commands into provider-level operations.

3. **Agent roles are domain concepts.** Planner, Implementor, and Reviewer are first-class domain
   roles with distinct dispatch rules, recovery behavior, and concurrency guards. They are not
   abstracted to generic "automation kind" strings. The engine understands these roles; it does not
   know how they execute. The runtime is pluggable, the roles are not. The architecture spec should
   include a short role contract for each (inputs, outputs, terminal states, concurrency guards,
   recovery rules).

4. **Terminology.** The system orchestrates AI agents, not generic "automations." Agent = the domain
   concept (a role with dispatch rules and lifecycle). Runtime = the execution mechanism (local
   Claude SDK, Sprites, etc.). The engine speaks in terms of agents; the runtime adapter is the
   pluggable layer.

### Provider abstraction

5. **Provider interfaces.** The engine operates on normalized domain types (`WorkItem`, `Revision`,
   `Spec`), not GitHub-specific types. GitHub becomes one provider implementation behind interfaces
   (`WorkProvider`, `RepoProvider`). The interfaces are provider-agnostic, but only one
   implementation (GitHub) is built — no multi-provider config or selection system.

6. **Provider read/write separation.** Provider interfaces are split into read and write surfaces
   (e.g. `WorkProviderReader` / `WorkProviderWriter`). Reads are freely callable by pollers and the
   query layer. Writes are only reachable through the CommandExecutor. This is enforced structurally
   — not by convention. A single GitHub implementation composes both interfaces, but only the
   CommandExecutor imports the write interface.

### Engine pipeline

7. **Pollers and the event pipeline.** Pollers are a scheduling mechanism — they call provider
   readers on an interval and produce domain events (`WorkItemChanged`, `RevisionChanged`,
   `SpecChanged`) that feed into the same handler pipeline as all other events. Pollers do not write
   to the state store directly or bypass handlers. They are the primary source of external state
   ingestion but are not architecturally special.

8. **Event/command flow.** Engine operates as:
   `Event → State Update → Handlers → Commands → CommandExecutor → Policy → Providers → Events`.
   Handlers are pure decision logic. Only providers (called by the CommandExecutor, behind the
   broker boundary) perform external mutations.

9. **Sequential event processing.** Events are processed one at a time. Each event is fully
   processed (state update → handlers → commands → execution) before the next event is dequeued.
   Commands that produce new events queue them for subsequent processing — they do not interleave
   with the current event's processing. This makes handler purity and concurrency guards trivial to
   reason about.

10. **Canonical engine state.** The engine owns a single state store containing: known WorkItems and
    their status, known Revisions and their pipeline status, active agent runs, and spec state.
    Events (from pollers and other sources) drive state updates. The TUI subscribes to this store.
    Handlers receive read-only snapshots of this store when making decisions. The TUI store becomes
    a thin projection, not a parallel state system.

11. **Handler-based dispatch.** Handlers are functions with a consistent shape:
    `(event, state) → commands[]`. Each handler is organized by workflow concern (planning, review,
    recovery, user dispatch). Handlers are wired explicitly at engine setup — no dynamic registry or
    plugin framework. The consistent shape is itself the extension point: moving to a dynamic
    registry later is a change to how handlers are collected, not how they work. Handlers return
    domain commands instead of calling services directly. Handlers receive read-only engine state
    and domain-typed events.

12. **Recovery via the event pipeline.** Recovery is not special-cased in the engine core. On
    startup, pollers perform their initial poll and emit normal domain events for all detected
    entities. A recovery handler reacts to work items that appear with status `in-progress` but no
    active agent run, and emits `TransitionWorkItemStatus(pending)`. Crash recovery follows the same
    pattern — agent failure events trigger handlers that decide on status transitions. No separate
    recovery module or bootstrap phase.

### Execution and enforcement

13. **CommandExecutor and the broker boundary.** The CommandExecutor is an explicit, named
    component. It takes domain commands, consults the policy layer, translates to provider
    operations, and emits result events. This is the "broker boundary" — all external writes must
    flow through it. The term "broker boundary" is retained as a conceptual name for enforcement,
    even though the implementation is CommandExecutor + Policy + provider write interfaces. The
    early whiteboarding "Broker" as a monolithic component is replaced by this composition.

14. **Concurrency enforcement in CommandExecutor.** Concurrency guards (one planner at a time, one
    agent per work item) are enforced in the CommandExecutor, not handlers. Handlers are pure — they
    emit intent. The CommandExecutor checks operational constraints before executing. Commands that
    violate concurrency constraints are rejected (not silently dropped). This prevents race
    conditions from multiple handler emissions and keeps guard logic centralized.

15. **Policy as boolean gate.** The policy layer is a function:
    `(command, state) → { allowed: boolean; reason?: string }`. It does not modify commands. If a
    command is disallowed, the CommandExecutor rejects it and logs the reason. Policy is a
    dependency of the CommandExecutor, not a separate layer in the pipeline. The CommandExecutor
    flow is: receive command → check concurrency → consult policy → translate → call provider → emit
    events.

16. **Artifact-based runtime interface with mutation boundary.** The runtime adapter interface is
    artifact-shaped: `AgentResult` carries structured output (patch, review, issues, etc.) and
    `AgentRunStream` carries live logs/output separately. The runtime must not perform external
    writes (git push, provider mutations). Even the local runtime produces artifacts only; all
    external mutations are executed via the CommandExecutor. Agent prompts are updated to not
    perform GitHub operations, and structured output is enforced via JSON schema. This is not
    deferred to sandbox — the mutation boundary is enforced from day one.

### State and query

17. **State selectors.** Engine state is accessed through named selector functions, not by reaching
    into the raw store shape. Selectors are centralized (e.g. `getWorkItemsInProgress(state)`,
    `getActiveAgentRun(state, workItemID)`). Handlers and the TUI both use selectors. This keeps
    state access consistent, makes queries testable, and decouples consumers from the store's
    internal structure.

18. **Query layer split.** The canonical state store serves the default TUI view (work items,
    revisions, specs, agent runs) — the TUI subscribes to this. On-demand detail fetches (issue
    body, PR files, review comments) go to provider readers because storing all detail in the
    canonical state would be wasteful. The engine exposes these as query methods that delegate to
    provider readers.

### Extension

19. **Sandbox / trust boundary.** The runtime adapter interface is designed so it _could_ work with
    a sandboxed runner, but the local runtime is the only implementation for now. The
    JWT-authenticated sandbox and process isolation are future extensions, not part of this
    rearchitecture. This is the most critical extension the system must support. Decision 16
    (artifact-based interface with mutation boundary) is the concrete mechanism that ensures the
    interface is sandbox-ready from day one.

### Documentation strategy

20. **Per-component specs.** The new architecture is conducive to one spec per component boundary.
    The migration plan (phase 2) identifies for each step: new specs to write, existing specs that
    become redundant, and existing specs that need modification.

21. **Spec-driven implementation.** Migration follows: read architecture spec and migration plan →
    read relevant existing specs → update/write affected specs → implementor implements → mark step
    done in migration plan.

22. **Three-layer documentation:**
    - Architecture spec — target state, stable, rarely updated.
    - Migration plan — sequenced steps, living document with progress tracking.
    - Component specs — updated per migration step, remain the source of truth for current state.

## Architecture spec must address

These are not plan-level decisions but topics the architecture spec must define. Listed here so the
spec author doesn't have to discover them independently.

- **Error propagation through the command chain** (decisions 8, 13, 15). What happens when a command
  is rejected by policy or a provider write fails? The current system has specific error categories
  (transient, permanent, non-fatal) — the spec should define how these map to the new pipeline.
- **Agent lifecycle state machine** (decisions 3, 10, 14). What states does an agent run pass
  through (requested, running, completed, failed, timed-out, cancelled)? The role contracts,
  recovery handler, and concurrency guards all depend on this.
- **TUI-engine contract** (decisions 10, 17, 18). How the TUI subscribes to engine state, dispatches
  commands, and accesses agent streams. The current interface (events, commands, queries, streams)
  needs mapping to the new model.
- **Worktree management ownership** (decision 16). Whether worktrees are managed by the engine, the
  runtime adapter, or a separate component. The artifact-based interface changes how worktrees
  relate to agent execution.

## Spec catalog

Disposition of all specs through the v2 migration. Phase 2 sequences these into migration steps.

### REWORK — Engine

| Spec                                    | Current Scope        | v2 Change                                                               |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `control-plane.md`                      | Overall architecture | Update for provider abstraction + broker boundary                       |
| `control-plane-engine.md`               | Engine internals     | Major rework — new processing loop, handler-based dispatch, state store |
| `control-plane-tui.md`                  | TUI                  | Subscription model, user events, no direct provider access              |
| `control-plane-engine-issue-poller.md`  | Issue polling        | Rename Issue → WorkItem, implement WorkProviderReader interface         |
| `control-plane-engine-pr-poller.md`     | PR polling           | Rename PR → Revision, implement RevisionProviderReader interface        |
| `control-plane-engine-spec-poller.md`   | Spec polling         | Implement SpecProviderReader interface, minor changes                   |
| `control-plane-engine-agent-manager.md` | Agent lifecycle      | Becomes runtime adapter — structured output, no side effects            |

### REWORK — Agents

| Spec                   | Current Scope     | v2 Change                                                     |
| ---------------------- | ----------------- | ------------------------------------------------------------- |
| `agent-planner.md`     | Planner agent     | Structured PlannerResult output, no direct GitHub operations  |
| `agent-implementor.md` | Implementor agent | Structured ImplementorResult, patch-based output, no git push |
| `agent-reviewer.md`    | Reviewer agent    | Structured ReviewerResult, no direct PR review posting        |

### REWORK — Workflow

| Spec                    | Current Scope         | v2 Change                                                    |
| ----------------------- | --------------------- | ------------------------------------------------------------ |
| `workflow.md`           | Workflow phases/roles | Update terminology (WorkItem, Revision), align with v2 roles |
| `workflow-contracts.md` | Interface contracts   | Output formats change to structured AgentResult types        |
| `script-label-setup.md` | Label setup script    | Labels change to match new WorkItemStatus values             |

### DELETE

| Spec                                             | Current Scope   | Reason                                                                     |
| ------------------------------------------------ | --------------- | -------------------------------------------------------------------------- |
| `control-plane-engine-recovery.md`               | Recovery        | Recovery is now handleOrphanedWorkItem + initial poll — no separate module |
| `control-plane-engine-planner-cache.md`          | Planner cache   | Replaced by `lastPlannedSHAs` in engine state store                        |
| `control-plane-engine-context-precomputation.md` | Trigger prompts | Context assembly becomes a runtime adapter concern                         |

### NEW

| Spec            | Scope                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| GitHub provider | Concrete implementation mapping GitHub API → domain types, composes all 5 reader/writer interfaces |
| CommandExecutor | Broker boundary, policy gate, concurrency guards, command translation, compound commands           |
| Handlers        | Handler catalog with per-handler behavior — triggers, emitted commands, edge cases                 |
| State store     | Zustand store shape, state update functions, selectors                                             |

### KEEP (unchanged or minimal impact)

| Spec                                            | Notes                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| `control-plane-engine-agent-session-logging.md` | Orthogonal to engine redesign, stays standalone |
| `github-cli.md`                                 | Used by Human role and skills, not agents       |
| `agent-hook-bash-validator.md`                  | Safety hooks still relevant                     |
| `agent-hook-bash-validator-script.md`           | Same                                            |
| `skill-spec-writing.md`                         | Not affected by engine redesign                 |
| `skill-agent-spec-writing.md`                   | Not affected                                    |
| `skill-github-workflow.md`                      | Used by Human role, not engine                  |
