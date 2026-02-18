---
title: Workflow Contracts
version: 0.8.0
last_updated: 2026-02-19
status: draft
---

# Workflow Contracts

## Overview

Shared data formats and templates used across workflow agents. Each format is defined once here and
referenced by the agent specs that produce or consume it. Agent structured output types
(`PlannerResult`, `ImplementorResult`, `ReviewerResult`) are defined in
[002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results) and detailed in the
respective agent specs — this document does not redefine them.

## Constraints

- This spec is the single source of truth for work item templates and scope enforcement rules —
  agent definitions reference these via cross-references, not inline copies.
- Agent structured output types are defined in 002-architecture.md — this spec does not duplicate
  type definitions.
- Every template must include all required fields; optional fields must be explicitly marked as
  optional.
- Template changes require a version bump in this spec and updates to all consuming agent specs.

## Specification

### Agent Result Types

Agents produce structured output validated by the runtime adapter. Each role has a distinct result
type — the engine processes these artifacts and does not rely on agents having performed side
effects.

| Role        | Result Type         | Defined In                                                                                           |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| Planner     | `PlannerResult`     | [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results), `agent-planner.md`     |
| Implementor | `ImplementorResult` | [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results), `agent-implementor.md` |
| Reviewer    | `ReviewerResult`    | [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results), `agent-reviewer.md`    |

In the v1 architecture, blocker information was posted as GitHub issue comments (Blocker Comment
Format), escalation information was posted as separate comments (Escalation Comment Format), and
reviews used markdown templates (Review Approval/Rejection Templates). In v2, all of this
information is carried in the agent's structured result:

- **Blocker and escalation information** is carried in `ImplementorResult.summary`. See
  [agent-implementor.md: Summary Guidelines](./agent-implementor.md#summary-guidelines) for content
  requirements per outcome.
- **Review verdicts and feedback** are carried in `ReviewerResult.review` (`AgentReview` with
  verdict, summary, and line-level comments). See
  [agent-reviewer.md: Structured Output](./agent-reviewer.md#structured-output) for the schema and
  comment format.
- **Planning results** are carried in `PlannerResult` with `create`, `close`, and `update` arrays
  using `tempID` references for dependency ordering. See
  [agent-planner.md: Completion Output](./agent-planner.md#completion-output) for the schema.

### Work Item Templates

#### Task Issue Template

Created by the Planner for each implementation work item. The `body` field of each `PlannedWorkItem`
in the `PlannerResult.create` array follows this template. Consumed by the Implementor (reads the
work item body to understand its assignment) and the Reviewer (reads the work item body to evaluate
the revision against).

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

- path/to/other.ts (owned by #<work-item-id>)

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Test: path/to/test.ts passes

## Context

Anything the agent needs beyond the spec.

## Constraints

What the agent must NOT do.
```

Labels at creation (included in `PlannedWorkItem.labels`):

- **Type:** `task:implement`
- **Status:** `status:pending`
- **Priority:** One of `priority:high`, `priority:medium`, `priority:low`
- **Complexity:** One of `complexity:trivial`, `complexity:low`, `complexity:medium`,
  `complexity:high`

#### Refinement Issue Template

Created by the Planner when it encounters ambiguity, contradiction, or a gap in a spec that prevents
task decomposition. The `body` field of the refinement `PlannedWorkItem` follows this template.
Refinement work items do not receive a complexity label.

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

Labels at creation (included in `PlannedWorkItem.labels`):

- **Type:** `task:refinement`
- **Status:** `status:pending`
- **Priority:** One of `priority:high` (default — blocks task creation), `priority:medium` (only if
  the ambiguous section does not block critical-path work)

### Scope Enforcement Rules

These rules govern what files an agent may modify. They are referenced by the Implementor (which
enforces them during implementation) and the Reviewer (which audits compliance during review).

1. **Primary scope:** Files listed in the work item's "In Scope" section. No restrictions on the
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
   primary scope. The agent documents the discrepancy in the revision body using a "Scope
   correction" section:

   ```
   ## Scope correction
   - **Listed:** `<file from In Scope list>`
   - **Actual:** `<correct file>`
   - **Reason:** <why the listed file is wrong and the actual file is correct>
   ```

   This rule applies when the task intent is unambiguous and the correct target is identifiable from
   reading the code. If the discrepancy makes the task intent unclear, the agent produces a
   `blocked` outcome. See
   [agent-implementor.md: Scope Enforcement](./agent-implementor.md#scope-enforcement).

When a file outside scope needs non-incidental changes:

- **Implementor:** Produces a `blocked` outcome if it blocks progress, or notes the scope conflict
  in the summary and continues if it does not. See
  [agent-implementor.md: Scope Enforcement](./agent-implementor.md#scope-enforcement).
- **Reviewer:** Records it as a warning (does not trigger rejection). See
  [agent-reviewer.md: Scope Compliance](./agent-reviewer.md#2-scope-compliance).

## Acceptance Criteria

- [ ] Given a task work item created from a `PlannerResult`, when the body is inspected, then it
      contains all required sections: Objective, Spec Reference, Scope (In Scope / Out of Scope),
      Acceptance Criteria, Context, Constraints.
- [ ] Given a task work item created from a `PlannerResult`, when the labels are inspected, then it
      has labels from all four categories: type, status, priority, and complexity.
- [ ] Given a refinement work item created from a `PlannerResult`, when the labels are inspected,
      then it does not have a complexity label.
- [ ] Given a scope enforcement decision, when a change qualifies under all three incidental-change
      criteria, then it is permitted without listing the file in "In Scope".
- [ ] Given a scope enforcement decision, when a change fails any one of the three incidental-change
      criteria, then the Implementor produces a `blocked` outcome or notes the conflict in the
      summary (not a silent modification).
- [ ] Given a work item whose In Scope list names a file that does not contain the expected code,
      when the correct target is identifiable from reading the codebase and the task intent is
      unambiguous, then the agent treats the correct file as effective primary scope and documents
      the discrepancy in the revision body.
- [ ] Given a work item whose In Scope list names a file that does not contain the expected code,
      when the discrepancy makes the task intent unclear, then the agent produces a `blocked`
      outcome.

## Dependencies

- [workflow.md](./workflow.md) — status labels, label taxonomy, lifecycle phases, and quality gates
  referenced by templates
- [agent-planner.md](./agent-planner.md) — consumes Task Issue Template and Refinement Issue
  Template for `PlannedWorkItem.body` formatting
- [agent-implementor.md](./agent-implementor.md) — consumes scope enforcement rules during
  implementation
- [agent-reviewer.md](./agent-reviewer.md) — consumes scope enforcement rules during review
- [002-architecture.md](./v2/002-architecture.md) — `PlannerResult`, `ImplementorResult`,
  `ReviewerResult`, `AgentReview` type definitions
- [script-label-setup.md](./script-label-setup.md) — label definitions (names, descriptions, colors)
  used in work item templates

## References

- `docs/specs/decree/v2/002-architecture.md` — Agent Results (structured output type definitions)
- `docs/specs/decree/workflow.md`
- `docs/specs/decree/agent-planner.md`
- `docs/specs/decree/agent-implementor.md`
- `docs/specs/decree/agent-reviewer.md`
- `docs/specs/decree/script-label-setup.md`
