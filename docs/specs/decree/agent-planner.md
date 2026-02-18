---
title: Planner Agent
version: 1.0.0
last_updated: 2026-02-19
status: approved
---

# Planner Agent

## Overview

Agent that analyzes approved specifications and decomposes work into structured work item
operations. The Planner is triggered when specification files change in `docs/specs/`. It reviews
existing work items for relevance, assesses what work remains against the current codebase,
decomposes specs into hermetic tasks, and produces a `PlannerResult` containing work items to
create, close, and update with dependency ordering via `tempID` references.

## Constraints

- Must not perform any external mutations. The Planner produces structured output only — all work
  item creation, closure, and updates are performed by the CommandExecutor when it processes the
  `ApplyPlannerResult` command.
- Must not narrate reasoning between tool calls. Output only: gate check results, action summaries
  (planned creates/updates/closes with titles), and the final structured output. No exploratory
  commentary.
- Must not make interpretive decisions about spec intent. Ambiguity, contradiction, or gaps must
  produce refinement work items in the `create` array, not guesses.
- The agent definition body must include the permitted bash command list from
  [agent-hook-bash-validator.md: Allowlist Prefixes](./agent-hook-bash-validator.md#allowlist-prefixes)
  to prevent wasted turns on blocked commands.

## Agent Profile

| Constraint       | Value                                   | Rationale                                                    |
| ---------------- | --------------------------------------- | ------------------------------------------------------------ |
| Model tier       | Opus                                    | Reliable multi-phase execution and codebase delta assessment |
| Tool access      | No write tools (Read, Grep, Glob, Bash) | Reads codebase for delta assessment; never modifies files    |
| Turn budget      | 50                                      | Bounded analysis with structured output                      |
| Permission model | Non-interactive with bash validation    | Runs unattended; bash validator enforces command safety      |

The agent definition (`.claude/agents/planner.md`) implements these constraints as frontmatter. See
[control-plane-engine-runtime-adapter-claude.md: Agent Definition Loading](./control-plane-engine-runtime-adapter-claude.md#agent-definition-loading)
for how the runtime adapter parses them.

## Trigger

The Planner is invoked when one or more specification files change with approved frontmatter status
and a `blobSHA` that differs from `lastPlannedSHAs`. The trigger mechanism is defined by the
`handlePlanning` handler (see
[002-architecture.md: Handler Catalog](./v2/002-architecture.md#catalog)).

When multiple specs change in the same poll cycle, they are all included in a single invocation.

## Inputs

### Injected Context

The runtime adapter assembles an enriched trigger prompt from `PlannerStartParams { specPaths }`.
See
[control-plane-engine-runtime-adapter-claude.md: Planner Context](./control-plane-engine-runtime-adapter-claude.md#planner-context)
for the prompt format and data resolution.

The enriched prompt contains:

1. **Spec content:** Full content of each changed spec, including frontmatter, acceptance criteria,
   and dependencies. The Planner does not need to read spec files from disk.
2. **Spec diffs:** For modified specs (those with a prior entry in `lastPlannedSHAs`), a unified
   diff showing what changed since the last successful Planner run. Added specs have no diff.
3. **Existing work items:** All work items in the state store with id, title, status, and body.

### Codebase State

Codebase state is not injected. The Planner reads the current codebase via tool calls (Read, Grep,
Glob) to assess what work is already done vs. what remains. This is the Planner's primary tool-use
activity.

## Idempotency

The engine does not prevent re-dispatch for the same spec (e.g., a whitespace-only change will
re-trigger the Planner). The Planner is responsible for idempotency: a re-invocation where existing
work items are current and the codebase satisfies all criteria must produce a `PlannerResult` with
all arrays empty. The pre-planning gates and existing work item review (Phases 1-2) are the
mechanisms that ensure this.

## Pre-Planning Gates

Before decomposition, the Planner validates the following quality gates for each input spec. Gates
are evaluated per spec — a failing spec is reported and skipped; passing specs proceed.

1. Spec frontmatter `status` is `approved`.
2. No existing work items with `needs-refinement` status reference this spec.

> **Rationale:** Gate 1 duplicates the trigger condition (`approved` status) as defense-in-depth —
> the trigger is evaluated by the handler at enqueue time, while the gate is evaluated by the agent
> at execution time. A spec's status could change between the two. Gate 2 uses `WorkItemStatus`
> domain values from the injected context rather than provider-specific label queries. The runtime
> adapter provides all work items with their current status — the Planner filters by status and spec
> reference to evaluate the gate.

For each spec that fails a gate, the Planner notes the failure (spec name, which gate failed, and
why) as chain-of-thought before continuing. If all specs fail, the Planner stops after reporting all
failures and outputs a `PlannerResult` with all arrays empty.

## Decomposition Process

The Planner executes the following phases in order. The ordering is a contract — each phase depends
on the output of the previous one.

### Phase 1: Review Existing Work Items

Before planning new work items, the Planner reviews all work items in the injected context that
reference any of the input specs. A work item references a spec if its body contains the spec file
path in the "Spec Reference" section. Work items that do not reference any input spec are ignored.

The Planner identifies:

1. **Irrelevant tasks:** Work items whose referenced spec section has been removed or whose work is
   no longer needed due to spec changes. Their ids are added to the `close` array of the result.
2. **Stale tasks:** Work items whose scope or acceptance criteria no longer match the updated spec.
   Added to the `update` array with revised body and/or labels.

When a new work item supersedes an existing one, the existing work item's id is added to `close`.
The new work item is added to `create` in the same result — the CommandExecutor processes creates
before closes.

### Phase 2: Assess Delta

Compare acceptance criteria across all input specs against the current codebase:

- Criteria already satisfied by the codebase do not need tasks.
- Criteria not satisfied (or partially satisfied) become the basis for task decomposition.

### Phase 3: Decompose into Tasks

Break remaining work into tasks. Each task must be:

- **Single objective:** One clear thing to accomplish.
- **Hermetic:** Completable by one Implementor without real-time coordination.
- **Buildable:** The codebase must compile after the task's changes are applied. When removing or
  changing shared exports, include all consumer updates in the same task.
- **Bounded:** Explicit In Scope and Out of Scope file lists. When two tasks could touch the same
  file, define non-overlapping boundaries (e.g., one task handles type definitions, another handles
  the implementation).
- **Derived:** Acceptance criteria come from the spec (subset of spec criteria, plus
  implementation-specific criteria).
- **Referenced:** Links to the specific spec file and section(s) it implements.
- **Right-sized:** Completable in a single Implementor invocation. Split large work into sequential
  tasks with dependencies.

### Phase 4: Build Structured Output

Assemble the `PlannerResult` from the decisions made in Phases 1-3:

1. Assign a unique `tempID` to each new work item (e.g., `temp-1`, `temp-2`).
2. For each new work item, populate `title`, `body`, `labels`, and `blockedBy`. The `body` follows
   the Task Issue Template (see
   [workflow-contracts.md: Task Issue Template](./workflow-contracts.md#task-issue-template)).
3. Express dependencies between new work items using `tempID` references in `blockedBy`.
   Dependencies on existing work items use their real work item ids.
4. Add ids of work items to close to the `close` array.
5. Add work item updates to the `update` array with the existing work item id and revised fields.

> **Rationale:** The `tempID` mechanism allows the Planner to express dependency ordering between
> new work items without knowing their real ids. The CommandExecutor processes creates in order,
> builds a tempID-to-real-id map, and resolves all `blockedBy` references. See
> [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results).

## Complexity Assessment

For each task, the Planner assigns a complexity label:

- `complexity:trivial` — Trivial changes, mechanical transformations, straightforward updates.
- `complexity:low` — Single-file changes, simple logic, boilerplate.
- `complexity:medium` — Multi-file changes with moderate coordination.
- `complexity:high` — Multi-file coordination, architectural decisions, nuanced logic, non-trivial
  error handling.

When in doubt, prefer higher complexity — the cost of under-resourcing a task (wasted turns, poor
output) exceeds the cost of over-resourcing (higher token cost).

Complexity labels are included in the `labels` array of each `PlannedWorkItem`.

## Priority Assignment

- `high` — Blocks other tasks or is on the critical path. Foundation work (types, core interfaces)
  that other tasks depend on.
- `medium` — Default. Standard implementation work with no special urgency.
- `low` — Nice-to-have, non-blocking, or can be deferred without impacting other work.

The Planner sequences tasks so that foundational work is marked `high` priority, with dependent
tasks referencing them via `blockedBy` in their `PlannedWorkItem`.

Priority labels are included in the `labels` array of each `PlannedWorkItem`.

## Spec Ambiguity Handling

When the Planner encounters ambiguity, contradiction, or a gap in the spec that prevents task
decomposition:

1. Add a refinement work item to the `create` array. The `body` follows the Refinement Issue
   Template (see
   [workflow-contracts.md: Refinement Issue Template](./workflow-contracts.md#refinement-issue-template)).
   The `labels` array includes the refinement type label and a priority label.
2. Do not create tasks that depend on the ambiguous section until the spec is clarified.
3. Continue creating tasks for unambiguous sections.

Refinement work items default to `priority:high` because they block task creation. Use
`priority:medium` only if the ambiguous section does not block critical-path work.

## Completion Output

The Planner's structured output is a `PlannerResult` validated by the runtime adapter via the
`PlannerOutputSchema` (see
[control-plane-engine-runtime-adapter-claude.md: Structured Output](./control-plane-engine-runtime-adapter-claude.md#structured-output)).

```
PlannerResult {
  role:    'planner'
  create:  PlannedWorkItem[]
  close:   string[]                       // existing WorkItem ids to close
  update:  PlannedWorkItemUpdate[]
}

PlannedWorkItem {
  tempID:    string                       // planner-assigned, unique within this result
  title:     string
  body:      string
  labels:    string[]
  blockedBy: string[]                     // tempIDs (from this result) or existing WorkItem ids
}

PlannedWorkItemUpdate {
  workItemID: string                      // existing WorkItem id
  body:       string | null               // null = no change
  labels:     string[] | null             // null = no change
}
```

Gate-failure-only and idempotent no-op runs produce a `PlannerResult` with all arrays empty.

## Acceptance Criteria

- [ ] Given a spec with `status: approved`, when the Planner runs, then the `create` array contains
      work items for all unsatisfied acceptance criteria.
- [ ] Given a spec with `status` other than `approved`, when the Planner runs, then it skips that
      spec with a gate failure report and continues processing remaining specs.
- [ ] Given existing work items with `needs-refinement` status that reference a spec, when the
      Planner runs, then it skips that spec with a gate failure report.
- [ ] Given existing work items that reference a removed spec section, when the Planner runs on the
      updated spec, then those work item ids appear in the `close` array.
- [ ] Given existing work items with outdated acceptance criteria, when the Planner runs on the
      updated spec, then those work items appear in the `update` array with revised body.
- [ ] Given an existing work item that is superseded by a new work item, when the Planner produces
      the result, then the existing work item id appears in `close` and the new work item appears in
      `create`.
- [ ] Given acceptance criteria that the codebase already satisfies, when the Planner runs, then no
      work items are created for those criteria.
- [ ] Given the Planner creates work items, when each `PlannedWorkItem` body is inspected, then it
      contains all required sections: Objective, Spec Reference, Scope (In Scope / Out of Scope),
      Acceptance Criteria, Context, Constraints.
- [ ] Given a task that removes or changes exports from a shared module, when the `PlannedWorkItem`
      is inspected, then its In Scope list includes all consumer files that reference those exports.
- [ ] Given two tasks that could touch the same file, when the Planner creates them, then their
      scope sections define non-overlapping boundaries.
- [ ] Given the Planner creates a task, when the task's acceptance criteria and constraints are
      inspected, then no criterion requires modifying a file that the task's Constraints or Out of
      Scope section excludes.
- [ ] Given a task that depends on another new task, when the `PlannedWorkItem` is inspected, then
      its `blockedBy` contains the dependency's `tempID`.
- [ ] Given a task that depends on an existing work item, when the `PlannedWorkItem` is inspected,
      then its `blockedBy` contains the existing work item's id.
- [ ] Given foundational work (types, interfaces, core modules), when the Planner creates the work
      item, then its `labels` array includes a high priority label.
- [ ] Given an ambiguous section in the spec, when the Planner encounters it, then a refinement work
      item appears in the `create` array instead of a guessed task.
- [ ] Given a re-invocation where existing work items are current and the codebase satisfies all
      criteria, then the `PlannerResult` has all arrays empty.
- [ ] Given each `PlannedWorkItem` in the `create` array, when its `tempID` is inspected, then it is
      unique within the result.

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — `PlannerResult`, `PlannedWorkItem`,
  `PlannedWorkItemUpdate` type definitions. `PlannerStartParams`. Agent Role Contracts (Planner).
- [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
  — Context assembly (enriched prompt format, data resolution). Structured output validation
  (`PlannerOutputSchema`). Agent definition loading.
- [workflow-contracts.md](./workflow-contracts.md) — Shared data formats: Task Issue Template,
  Refinement Issue Template.
- [agent-hook-bash-validator.md](./agent-hook-bash-validator.md) — PreToolUse hook that validates
  all Bash commands against blocklist/allowlist before execution.

## References

- [002-architecture.md: Agent Role Contracts (Planner)](./v2/002-architecture.md#planner) — Trigger,
  input, output, concurrency, and status flow.
- [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results) — `PlannerResult`
  type and `tempID` resolution mechanism.
- [control-plane-engine-runtime-adapter-claude.md: Planner Context](./control-plane-engine-runtime-adapter-claude.md#planner-context)
  — Enriched prompt format and data resolution for planner sessions.
- [control-plane-engine.md](./control-plane-engine.md) — Engine wiring and handler dispatch.
- [workflow.md](./workflow.md) — Development Protocol (Planner role, Planning Phase).
- [script-label-setup.md](./script-label-setup.md) — Label definitions for the repository.
