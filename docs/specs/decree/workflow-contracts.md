---
title: Workflow Contracts
version: 1.0.0
last_updated: 2026-02-19
status: draft
---

# Workflow Contracts

## Overview

Shared data formats and templates used across workflow agents. Each format is defined once here and
referenced by the agent specs that produce or consume it.

In the v2 architecture, agents produce structured artifacts validated by runtime adapter schemas.
The engine processes these artifacts into provider operations — agents do not perform external
mutations. This spec defines the structured output types, work item body templates, and scope
enforcement rules that govern agent behavior.

## Constraints

- This spec is the single source of truth for all workflow output formats — agent definitions
  reference these formats via cross-references, not inline copies
- All output types must match the `AgentResult` types defined in
  [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results)
- Every field in a structured output type must be documented with its purpose and constraints
- Template changes require a version bump in this spec and updates to all consuming agent specs
- Agents produce structured artifacts only — no direct GitHub operations, no `gh.sh` usage, no
  status transitions, no review posting

## Specification

### Structured Output Formats

All agent output types are defined in
[002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results). This section documents
each type with field-level semantics and usage rules. Runtime adapters validate these outputs
against Zod schemas — see
[control-plane-engine-runtime-adapter-claude.md: Agent Output Schemas](./control-plane-engine-runtime-adapter-claude.md#agent-output-schemas).

#### PlannerResult

Produced by the Planner as its structured output. Captures the full work item delta — every create,
close, and update operation from the run — with dependency ordering via `tempID` references.

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

Field rules:

- `role` is always `'planner'`.
- `create` contains new work items in creation order. Each has a unique `tempID` within the result.
- `close` contains ids of existing work items to close (removed or superseded by spec changes).
- `update` contains modifications to existing work items (revised body, updated labels).
- `blockedBy` may reference `tempID` values from the same result (for inter-task dependencies) or
  existing work item ids (for dependencies on prior work).
- Gate-failure-only and idempotent no-op runs produce a `PlannerResult` with all arrays empty.
- The `body` of each `PlannedWorkItem` follows the Task Issue Template or Refinement Issue Template
  (see [Work Item Body Templates](#work-item-body-templates)).

The engine's `ApplyPlannerResult` command processes creates in order, builds a tempID-to-real-id
map, resolves all `blockedBy` references, processes closes, and processes updates. See
[002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results) for the resolution
mechanism.

#### ImplementorResult

Produced by the Implementor as its structured output on every run. The runtime adapter validates the
agent-produced fields and enriches the result with the extracted patch.

```
ImplementorResult {
  role:     'implementor'
  outcome:  'completed' | 'blocked' | 'validation-failure'
  patch:    string | null                 // present only when outcome is completed
  summary:  string                        // what was done, or why it couldn't be done
}
```

Field rules:

- `role` is always `'implementor'`.
- `outcome` is a three-way discriminator:
  - `completed` — Work item fully implemented and validated. The worktree contains committable
    changes.
  - `blocked` — Progress prevented by an issue outside the agent's control (spec ambiguity,
    dependency, scope constraint).
  - `validation-failure` — Pre-submit validation failed due to something outside the agent's scope
    or debugging limits were reached.
- `patch` is populated by the runtime adapter (not the agent) via `git diff` after the session
  completes. Present only when `outcome` is `completed`; `null` otherwise. See
  [control-plane-engine-runtime-adapter-claude.md: Patch Extraction](./control-plane-engine-runtime-adapter-claude.md#patch-extraction).
- `summary` serves two audiences: the engine (for status transitions and work item updates) and the
  human operator (for understanding what happened). Content varies by outcome — see
  [Summary Content by Outcome](#summary-content-by-outcome).

The engine's `ApplyImplementorResult` command handles outcome-dependent operations: creating a
revision from the patch and transitioning status for `completed`, or transitioning status to
`blocked` or `needs-refinement` for non-completed outcomes. See
[002-architecture.md: Implementor](./v2/002-architecture.md#implementor) for the full status flow.

##### Summary Content by Outcome

The `summary` field replaces the v1 Blocker Comment Format and Escalation Comment Format. It carries
the same information as plain text within the structured output rather than as separate GitHub issue
comments.

| Outcome              | Summary content                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`          | Brief description of what was implemented and tested.                                                                                                          |
| `blocked`            | Blocker type (embedded as text, e.g., "Type: spec-gap"), description, spec reference (for spec blockers), options with trade-offs, recommendation, and impact. |
| `validation-failure` | Which validation step failed, what the agent tried, and why the failure is outside its scope.                                                                  |

For `blocked` outcomes, the summary must include:

- **Blocker type** — one of: `spec-ambiguity`, `spec-contradiction`, `spec-gap`,
  `external-dependency`, `technical-constraint`, `debugging-limit`.
- **Description** — what is blocking progress.
- **Spec reference** (required for spec blockers) — file path, section name, and relevant quote.
- **Options** — at least two options with trade-offs.
- **Recommendation** — which option and why.
- **Impact** — what happens if the blocker is not resolved.

#### ReviewerResult

Produced by the Reviewer as its structured output. Contains a structured verdict with optional
line-level comments.

```
ReviewerResult {
  role:   'reviewer'
  review: AgentReview
}

AgentReview {
  verdict:     'approve' | 'needs-changes'
  summary:     string
  comments:    AgentReviewComment[]
}

AgentReviewComment {
  path:        string
  line:        number | null
  body:        string
}
```

Field rules:

- `role` is always `'reviewer'`.
- `verdict` is a two-way discriminator:
  - `approve` — All review checklist steps pass with no findings. The summary confirms approval and
    includes any warnings for visibility.
  - `needs-changes` — One or more checklist steps have findings. The summary describes the findings.
- `summary` provides a high-level overview of the review result. For approvals, it confirms all
  checks passed and lists any warnings. For rejections, it summarizes the findings.
- `comments` contains per-file findings and warnings. Each comment references a specific file path
  and optionally a line number. Findings that are general (e.g., missing test coverage for a
  criterion) use the most relevant file path with `line: null`.
- Warnings are included in `comments` with a `[Warning]` prefix in the body to distinguish them from
  findings. Warnings do not influence the verdict.

Each finding in a `needs-changes` review must include all three components:

- **What** — the specific file, line, or criterion with the issue.
- **Why** — reference to the spec, convention, or criterion that is violated.
- **Fix** — concrete, actionable guidance for resolving the issue.

The engine's `ApplyReviewerResult` command posts the review to the revision (or updates an existing
review) and transitions the work item status based on the verdict. See
[002-architecture.md: Reviewer](./v2/002-architecture.md#reviewer) for the full status flow.

### Work Item Body Templates

These templates define the structure of work item bodies created by the Planner. They are used for
the `body` field of `PlannedWorkItem` entries in the `PlannerResult`. Consumed by the Implementor
(reads the work item body to understand its assignment) and the Reviewer (reads the work item body
to evaluate the revision against).

#### Task Issue Template

Created by the Planner for each implementation task.

```markdown
## Objective

One sentence: what this task achieves.

## Spec Reference

- Spec: `docs/specs/<name>.md`
- Section(s): <relevant sections>

## Scope

### In Scope

Files/modules this task may touch:

- path/to/file.ts
- path/to/file.test.ts

### Out of Scope

Files/modules explicitly excluded:

- path/to/other.ts (owned by #<issue-number>)

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Test: path/to/test.ts passes

## Context

Anything the agent needs beyond the spec.

## Constraints

What the agent must NOT do.
```

Labels at creation:

- **Type:** `task:implement`
- **Status:** `status:pending`
- **Priority:** One of `priority:high`, `priority:medium`, `priority:low`
- **Complexity:** One of `complexity:trivial`, `complexity:low`, `complexity:medium`,
  `complexity:high`

#### Refinement Issue Template

Created by the Planner when it encounters ambiguity, contradiction, or a gap in a spec that prevents
task decomposition. Refinement issues do not receive a complexity label.

```markdown
## Ambiguity

What is ambiguous, contradictory, or missing in the spec.

## Spec Reference

- Spec: `docs/specs/<name>.md`
- Section(s): <relevant sections>
- Quote: "<relevant text from spec>"

## Options

1. **Option A** — description and trade-offs
2. **Option B** — description and trade-offs

## Recommendation

Which option and why.

## Blocked Tasks

Tasks that cannot be created until this is resolved.
```

Labels at creation:

- **Type:** `task:refinement`
- **Status:** `status:pending`
- **Priority:** One of `priority:high` (default — blocks task creation), `priority:medium` (only if
  the ambiguous section does not block critical-path work)

### Scope Enforcement Rules

These rules govern what files an agent may modify. They are referenced by the Implementor (which
enforces them during implementation) and the Reviewer (which audits compliance during review).

1. **Primary scope:** Files listed in the task issue's "In Scope" section. No restrictions on the
   nature or size of changes.

2. **Co-located test files:** Test files adjacent to in-scope files (e.g., `foo.test.ts` next to
   `foo.ts`) are implicitly in scope, even if not explicitly listed.

3. **Incidental changes:** Files outside primary scope that were modified as a direct consequence of
   in-scope work. A change qualifies as incidental when all of the following are true:
   - It is behavior-preserving (no new features, no control-flow changes, no default value changes,
     no externally observable semantic changes).
   - It is directly motivated by the in-scope change (e.g., required for compilation, shared helper
     extraction, type updates).
   - It is narrowly scoped and limited to what is necessary.

4. **Scope inaccuracy:** When the In Scope list names a file that does not contain the expected code
   (e.g., the task describes modifying a handler in file A, but the handler actually lives in file
   B), the agent determines the correct target file from the codebase and treats it as the effective
   primary scope. The agent documents the discrepancy in a commit message.

   This rule applies when the task intent is unambiguous and the correct target is identifiable from
   reading the code. If the discrepancy makes the task intent unclear, the agent treats it as a
   blocker (type: `spec-gap`).

When a file outside scope needs non-incidental changes:

- **Implementor:** Produces a `blocked` outcome (type: `technical-constraint`) if it blocks
  progress, or notes the scope conflict in the summary and continues if it does not.
- **Reviewer:** Records it as a warning (does not trigger rejection).

## Acceptance Criteria

### Structured Output Formats

- [ ] Given a `PlannerResult`, when inspected, then every `PlannedWorkItem` in `create` has a unique
      `tempID` within the result.
- [ ] Given a `PlannerResult`, when inspected, then every `PlannedWorkItem.body` follows the Task
      Issue Template or Refinement Issue Template structure.
- [ ] Given a `PlannerResult` from a gate-failure-only or idempotent no-op run, when inspected, then
      all arrays are empty.
- [ ] Given an `ImplementorResult` with `completed` outcome, when inspected, then `patch` is
      non-null and `summary` describes what was implemented.
- [ ] Given an `ImplementorResult` with `blocked` outcome, when inspected, then `summary` contains
      the blocker type, description, at least two options, and a recommendation.
- [ ] Given an `ImplementorResult` with `blocked` outcome and a spec blocker type, when inspected,
      then `summary` contains a spec reference with file path, section, and quote.
- [ ] Given an `ImplementorResult` with `validation-failure` outcome, when inspected, then `summary`
      identifies which validation step failed and why it is outside the agent's scope.
- [ ] Given a `ReviewerResult` with `needs-changes` verdict, when inspected, then every finding in
      `comments` includes all three fields (What, Why, Fix).
- [ ] Given a `ReviewerResult` with `approve` verdict, when inspected, then `comments` contains no
      findings (only warnings, if any, with `[Warning]` prefix).

### Work Item Body Templates

- [ ] Given a task work item created from the Task Issue Template, when inspected, then it has
      labels from all four categories: type, status, priority, and complexity.
- [ ] Given a refinement work item created from the Refinement Issue Template, when inspected, then
      it does not have a complexity label.

### Scope Enforcement

- [ ] Given a scope enforcement decision, when a change qualifies under all three incidental-change
      criteria, then it is permitted without listing the file in "In Scope".
- [ ] Given a scope enforcement decision, when a change fails any one of the three incidental-change
      criteria, then the Implementor produces a `blocked` outcome or notes the scope conflict in the
      summary (not a silent modification).
- [ ] Given a task whose In Scope list names a file that does not contain the expected code, when
      the correct target is identifiable from reading the codebase and the task intent is
      unambiguous, then the agent treats the correct file as effective primary scope and documents
      the discrepancy in a commit message.
- [ ] Given a task whose In Scope list names a file that does not contain the expected code, when
      the discrepancy makes the task intent unclear, then the agent treats it as a blocker (type:
      `spec-gap`).

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — `PlannerResult`, `PlannedWorkItem`,
  `PlannedWorkItemUpdate`, `ImplementorResult`, `ReviewerResult`, `AgentReview`,
  `AgentReviewComment` type definitions
- [workflow.md](./workflow.md) — status labels, label taxonomy, lifecycle phases, and quality gates
  referenced by templates
- [agent-planner.md](./agent-planner.md) — consumes Task Issue Template, Refinement Issue Template,
  and `PlannerResult` format
- [agent-implementor.md](./agent-implementor.md) — consumes `ImplementorResult` format and scope
  enforcement rules
- [agent-reviewer.md](./agent-reviewer.md) — consumes `ReviewerResult` / `AgentReview` format and
  scope enforcement rules
- [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
  — Zod schemas for structured output validation, patch extraction
- [script-label-setup.md](./script-label-setup.md) — label definitions (names, descriptions, colors)
  used in work item templates

## References

- `docs/specs/decree/v2/002-architecture.md`
- `docs/specs/decree/workflow.md`
- `docs/specs/decree/agent-planner.md`
- `docs/specs/decree/agent-implementor.md`
- `docs/specs/decree/agent-reviewer.md`
- `docs/specs/decree/control-plane-engine-runtime-adapter-claude.md`
- `docs/specs/decree/script-label-setup.md`
