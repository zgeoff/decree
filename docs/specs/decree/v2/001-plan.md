---
title: Architecture v2 — Plan
version: 0.1.0
last_updated: 2026-02-15
status: draft
---

# Architecture v2 — Plan

This document tracks the architectural redesign of the decree control plane. It captures decisions
made and the phases of work. Once each phase is complete, this document gets cleaned up or retired.

## Phases

- [ ] **Phase 1: Architecture spec** — Write the architecture spec capturing the target
      architecture.
- [ ] **Phase 2: Migration plan** — Write the migration plan with sequenced incremental refactors.
      Each step identifies: what changes, affected modules, verification criteria, and spec impact
      (new spec / spec becomes redundant / spec needs modification).
- [ ] **Phase 3: Spec-driven migration** — For each migration step: update affected specs first,
      then implement, then mark the step done.

## Decisions

### Architecture

1. **Provider abstraction.** The engine operates on normalized domain types (`WorkItem`, `Revision`,
   `Spec`), not GitHub-specific types. GitHub becomes one provider implementation behind interfaces
   (`WorkProvider`, `RepoProvider`). The interfaces are provider-agnostic, but only one
   implementation (GitHub) is built — no multi-provider config or selection system.

2. **CommandExecutor and the broker boundary.** The CommandExecutor is an explicit, named component.
   It takes domain commands, consults the policy layer, translates to provider operations, and emits
   result events. This is the "broker boundary" — all external writes must flow through it. The term
   "broker boundary" is retained as a conceptual name for enforcement, even though the
   implementation is CommandExecutor + Policy + provider write interfaces. The early whiteboarding
   "Broker" as a monolithic component is replaced by this composition.

3. **Provider read/write separation.** Provider interfaces are split into read and write surfaces
   (e.g. `WorkProviderReader` / `WorkProviderWriter`). Reads are freely callable by pollers and the
   query layer. Writes are only reachable through the CommandExecutor. This is enforced structurally
   — not by convention. A single GitHub implementation composes both interfaces, but only the
   CommandExecutor imports the write interface.

4. **Domain-level commands.** Commands are domain concepts (`TransitionWorkItemStatus`,
   `AnnotateRevision`, `RequestAgentRun`), not provider-specific operations. The CommandExecutor
   translates domain commands into provider-level operations.

5. **Agent roles are domain concepts.** Planner, Implementor, and Reviewer are first-class domain
   roles with distinct dispatch rules, recovery behavior, and concurrency guards. They are not
   abstracted to generic "automation kind" strings. The engine understands these roles; it does not
   know how they execute. The runtime is pluggable, the roles are not. The architecture spec should
   include a short role contract for each (inputs, outputs, terminal states, concurrency guards,
   recovery rules).

6. **Domain model.** Three domain concepts:
   - `WorkItem` — normalized from issues/tickets. Carries status, labels, metadata.
   - `Revision` — normalized from PRs/merge requests. Carries pipeline/CI status as a property (not
     a separate entity).
   - `Spec` — lightweight domain concept for spec files. Carries frontmatter status and file
     identity. Not as rich as WorkItem/Revision, but visible to the domain model with its own events
     (`SpecChanged`, `SpecApproved`). Without this, spec handling leaks filesystem details into
     handlers.

7. **Terminology.** The system orchestrates AI agents, not generic "automations." Agent = the domain
   concept (a role with dispatch rules and lifecycle). Runtime = the execution mechanism (local
   Claude SDK, Sprites, etc.). The engine speaks in terms of agents; the runtime adapter is the
   pluggable layer.

8. **Pollers and the event pipeline.** Pollers are a scheduling mechanism — they call provider
   readers on an interval and produce domain events (`WorkItemChanged`, `RevisionChanged`,
   `SpecChanged`) that feed into the same handler pipeline as all other events. Pollers do not write
   to the state store directly or bypass handlers. They are the primary source of external state
   ingestion but are not architecturally special.

9. **Event/command flow.** Engine operates as:
   `Event → State Update → Handlers → Commands → CommandExecutor → Policy → Providers → Events`.
   Handlers are pure decision logic. Only providers (called by the CommandExecutor, behind the
   broker boundary) perform external mutations.

10. **Canonical engine state.** The engine owns a single state store containing: known WorkItems and
    their status, known Revisions and their pipeline status, active agent runs, and spec state.
    Events (from pollers and other sources) drive state updates. The TUI subscribes to this store.
    Handlers receive read-only snapshots of this store when making decisions. The TUI store becomes
    a thin projection, not a parallel state system.

11. **Artifact-based runtime interface.** The runtime adapter interface is artifact-shaped:
    `AgentResult` carries structured output (patch, review, issues, etc.) and `AgentRunStream`
    carries live logs/output separately. This is the contract the engine programs against. The local
    runtime implementation may still have agents performing git operations internally — what matters
    is that the engine interacts with the runtime through the artifact interface. When sandbox
    support arrives, the local runtime's internals get replaced; the engine doesn't change.

12. **Handler-based dispatch.** Handlers are functions with a consistent shape:
    `(event, state) → commands[]`. Each handler is organized by workflow concern (planning, review,
    recovery, user dispatch). Handlers are wired explicitly at engine setup — no dynamic registry or
    plugin framework. The consistent shape is itself the extension point: moving to a dynamic
    registry later is a change to how handlers are collected, not how they work. Handlers return
    domain commands instead of calling services directly. Handlers receive read-only engine state
    and domain-typed events.

13. **Sandbox / trust boundary.** The runtime adapter interface should be designed so it _could_
    work with a sandboxed runner, but the local runtime is the only implementation for now. The
    JWT-authenticated sandbox and process isolation are future extensions, not part of this
    rearchitecture. This is the most critical extension the system must support — the interface
    design must not preclude it. Decision 11 (artifact-based interface) is the concrete mechanism
    that ensures this.

### Documentation strategy

14. **Per-component specs.** The new architecture is conducive to one spec per component boundary.
    The migration plan (phase 2) identifies for each step: new specs to write, existing specs that
    become redundant, and existing specs that need modification.

15. **Spec-driven implementation.** Migration follows: read architecture spec and migration plan →
    read relevant existing specs → update/write affected specs → implementor implements → mark step
    done in migration plan.

16. **Three-layer documentation:**
    - Architecture spec — target state, stable, rarely updated.
    - Migration plan — sequenced steps, living document with progress tracking.
    - Component specs — updated per migration step, remain the source of truth for current state.

## Architecture spec must address

These are not plan-level decisions but topics the architecture spec must define. Listed here so the
spec author doesn't have to discover them independently.

- **Error propagation through the command chain.** What happens when a command is rejected by policy
  or a provider write fails? The current system has specific error categories (transient, permanent,
  non-fatal) — the spec should define how these map to the new pipeline.
- **Concurrency enforcement.** Where do concurrency guards live (one planner at a time, one agent
  per work item)? Candidates: handlers, policy layer, CommandExecutor. The spec should pick one.
- **TUI-engine contract.** How the TUI subscribes to engine state, dispatches commands, and accesses
  agent streams. The current interface (events, commands, queries, streams) needs mapping to the new
  model.
- **Policy layer shape.** What the policy layer is concretely — a function, a rule set, an
  interface. What inputs it receives and what outputs it produces.
- **Recovery model.** How startup recovery and crash recovery fit into the handler pipeline. Whether
  recovery is a handler, a bootstrap phase, or both.
- **Worktree management ownership.** Whether worktrees are managed by the engine, the runtime
  adapter, or a separate component. The artifact-based interface (decision 11) changes how worktrees
  relate to agent execution.
- **Query layer.** Whether on-demand queries (issue details, PR files, CI status) become provider
  reader calls exposed through the engine, state store reads, or a mix.

## Existing specs

For reference, these are the current specs that will be evaluated during phase 2:

| Spec                                             | Scope                    |
| ------------------------------------------------ | ------------------------ |
| `control-plane.md`                               | Overall architecture     |
| `control-plane-engine.md`                        | Engine internals         |
| `control-plane-engine-agent-manager.md`          | Agent lifecycle          |
| `control-plane-engine-agent-session-logging.md`  | Session logging          |
| `control-plane-engine-context-precomputation.md` | Trigger prompts          |
| `control-plane-engine-issue-poller.md`           | Issue polling            |
| `control-plane-engine-planner-cache.md`          | Planner cache            |
| `control-plane-engine-pr-poller.md`              | PR polling               |
| `control-plane-engine-spec-poller.md`            | Spec polling             |
| `control-plane-engine-recovery.md`               | Recovery                 |
| `control-plane-tui.md`                           | TUI                      |
| `workflow.md`                                    | Workflow phases/roles    |
| `workflow-contracts.md`                          | Interface contracts      |
| `agent-planner.md`                               | Planner agent            |
| `agent-implementor.md`                           | Implementor agent        |
| `agent-reviewer.md`                              | Reviewer agent           |
| `agent-hook-bash-validator.md`                   | Bash validation rules    |
| `agent-hook-bash-validator-script.md`            | Bash validation script   |
| `github-cli.md`                                  | GitHub CLI operations    |
| `script-label-setup.md`                          | Label setup script       |
| `skill-spec-writing.md`                          | Spec writing skill       |
| `skill-agent-spec-writing.md`                    | Agent spec writing skill |
| `skill-github-workflow.md`                       | GitHub workflow skill    |
