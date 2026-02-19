---
title: Reviewer Agent
version: 1.0.0
last_updated: 2026-02-19
status: approved
---

# Reviewer Agent

## Overview

Agent that reviews completed implementation work against acceptance criteria, spec conformance, code
quality, and scope boundaries. The Reviewer produces a structured `ReviewerResult` containing a
verdict (`approve` or `needs-changes`), a summary, and optional line-level comments. The agent does
not post reviews, transition statuses, or perform any external mutations — the engine processes the
structured artifact and handles all downstream operations.

## Constraints

- Must not perform any external mutations — no GitHub operations, no status transitions, no review
  posting. The agent's sole output is a structured `ReviewerResult`.
- Must never issue a `needs-changes` verdict without providing actionable feedback. Each finding
  must include what is wrong, why it is wrong, and what to change.
- Scope issues are reported as warnings, not as findings that trigger rejection.
- The agent definition body must include the permitted bash command list from
  [agent-hook-bash-validator.md: Allowlist Prefixes](./agent-hook-bash-validator.md#allowlist-prefixes)
  to prevent wasted turns on blocked commands.
- Must read the full source file for any file with non-trivial changes; the injected diff is for
  triage and identification only.
- Must read changed test files in full to assess coverage, assertion quality, and setup correctness.
- Must cross-reference each prior review comment against the current diff during re-reviews;
  comments referencing unmodified code must be investigated.
- Must fetch referenced spec sections via tool calls; spec content is not included in the enriched
  prompt.
- When uncertain whether an issue constitutes a finding, the agent must err toward recording it as a
  finding — false positives are correctable in revision, but false negatives ship to integration.

## Agent Profile

| Constraint       | Value                                   | Rationale                                               |
| ---------------- | --------------------------------------- | ------------------------------------------------------- |
| Model tier       | Sonnet                                  | Read-only analysis; Opus not required                   |
| Tool access      | No write tools (Read, Grep, Glob, Bash) | Must never modify the codebase under review             |
| Turn budget      | 50                                      | Bounded analysis, not open-ended work                   |
| Permission model | Non-interactive with bash validation    | Runs unattended; bash validator enforces command safety |

The agent definition (`.claude/agents/reviewer.md`) implements these constraints as frontmatter. See
[control-plane-engine-runtime-adapter-claude.md: Agent Definition Loading](./control-plane-engine-runtime-adapter-claude.md#agent-definition-loading)
for how the runtime adapter parses them.

## Trigger

The Reviewer is dispatched when a linked revision's pipeline status transitions to `success` (CI
passed). The dispatch mechanism is defined by the `handleReview` handler — see
[control-plane-engine-handlers.md: handleReview](./control-plane-engine-handlers.md#handlereview).

## Inputs

The runtime adapter assembles an enriched trigger prompt from the minimal
`ReviewerStartParams { role: 'reviewer', workItemID, revisionID }`. See
[control-plane-engine-runtime-adapter-claude.md: Reviewer Context](./control-plane-engine-runtime-adapter-claude.md#reviewer-context)
for the prompt format and data resolution.

The enriched prompt contains:

1. **Work item details** — ID, title, body (objective, spec reference, scope, acceptance criteria),
   and status.
2. **Revision diffs** — per-file patches (path, status, unified diff) for all changed files in the
   linked revision.
3. **Prior review history** — review submissions (author, state, body) and inline comments (author,
   body, path, line) from prior Reviewer runs and human reviewers. Omitted on first review.

Additionally:

- **Project context:** CLAUDE.md content (coding conventions, style rules, architecture) appended to
  the agent's system prompt. See
  [control-plane-engine-runtime-adapter-claude.md: Project Context Injection](./control-plane-engine-runtime-adapter-claude.md#project-context-injection).
- **Working directory:** The repository root. The Reviewer reads source files on the default branch
  via tool calls; revision diffs are provided in the enriched prompt.

> **Rationale:** The Reviewer does not need a worktree — revision diffs are pre-computed in the
> enriched prompt, and source file reads against the default branch are sufficient for code quality
> assessment. See
> [control-plane-engine-runtime-adapter-claude.md: Planner and Reviewer Working Directory](./control-plane-engine-runtime-adapter-claude.md#planner-and-reviewer-working-directory).

## Review Checklist

The agent evaluates the revision against each of the following criteria. All six steps run on every
review — individual failures do not short-circuit the remaining steps. Findings from all steps are
collected into the `ReviewerResult`'s `review.comments` array with file paths and line references
where applicable.

**Warnings vs. findings:** If a step's required input is missing (e.g., no Scope section, no Spec
Reference, spec file does not exist or is not `status: approved`), the agent records a warning for
that step and proceeds to the next. Warnings indicate a step was skipped or a scope observation;
findings indicate a problem with the code. Warnings do not count toward the verdict decision but are
included in both the `review.summary` and the `review.comments` array (with a `[Warning]` prefix)
for visibility.

### 1. Unresolved Review Findings

On a first review (no prior review history in the enriched prompt), this step passes trivially —
there are no prior issues to verify.

On re-reviews:

- Verify each previously raised issue has been addressed: either the code was changed to resolve it,
  or the author replied explaining why no change is needed.
- Record unaddressed items as findings.

### 2. Scope Compliance

Compare files modified in the revision diff against the work item's scope, applying the scope
enforcement rules defined in
[workflow-contracts.md: Scope Enforcement Rules](./workflow-contracts.md#scope-enforcement-rules).

If the revision description contains a "Scope correction" section (rule 4 of the scope enforcement
rules), files listed as the corrected scope are treated as effective primary scope — no warning is
recorded.

If a modified file is neither in primary scope, a co-located test file, an incidental change, nor
covered by a documented scope inaccuracy, record it as a warning (not a finding) with an
explanation.

### 3. Task Constraints

If the work item includes a "Constraints" section, verify the implementation honors each constraint.
Record a per-constraint breakdown: which were satisfied and which were violated, with an explanation
for each violation. If the section is absent, record a warning and proceed.

### 4. Acceptance Criteria Verification

For each acceptance criterion in the work item:

- Verify the implementation satisfies it.
- Check that tests exist which exercise it.
- Record a per-criterion breakdown: which passed, which failed, and an explanation for each failure.

### 5. Spec Conformance

Read the referenced spec sections and compare the implementation against the specified behavior.
Verify the implementation does not contradict, omit, or extend beyond what the spec requires. Record
deviations with the specific spec file, section, and description.

### 6. Code Quality and Consistency

Verify code follows the project's style, naming conventions, and patterns defined in `CLAUDE.md`.
Check for readability, maintainability, consistency with existing codebase patterns, and common
issues (missing error handling at system boundaries, security vulnerabilities, unnecessary
complexity). Record issues with specific file paths, line references, and suggested improvements.

## Structured Output

The agent produces a `ReviewerResult` as its structured output. The runtime adapter validates this
via the `ReviewerOutputSchema` — see
[control-plane-engine-runtime-adapter-claude.md: Agent Output Schemas](./control-plane-engine-runtime-adapter-claude.md#agent-output-schemas).

```
ReviewerResult {
  role:   'reviewer'
  review: AgentReview
}

AgentReview {
  verdict:  'approve' | 'needs-changes'
  summary:  string
  comments: AgentReviewComment[]
}

AgentReviewComment {
  path: string
  line: number | null
  body: string
}
```

Types are defined in [domain-model.md: Agent Results](./domain-model.md#agent-results).

### Verdict

- **`approve`** — All checklist steps pass with no findings. The summary confirms approval and
  includes any warnings for visibility.
- **`needs-changes`** — One or more checklist steps have findings. The summary describes the
  findings. Each finding must include what is wrong, why it is wrong, and what to change.

### Comments

Each finding or warning that references a specific file location is recorded as an
`AgentReviewComment` with `path` and `line`. Findings that are general (e.g., missing test coverage
for a criterion, unresolved prior review comment) use the most relevant file path with `line: null`.

Warnings are included in comments with a `[Warning]` prefix in the body to distinguish them from
findings. Warnings do not influence the verdict.

### Result Processing

The agent does not post the review or transition work item status. The engine processes the
`ReviewerResult` via the `ApplyReviewerResult` command — see
[control-plane-engine-command-executor.md: ApplyReviewerResult](./control-plane-engine-command-executor.md#applyreviewerresult).

The `ApplyReviewerResult` command posts the review to the revision (or updates an existing review)
and transitions the work item status based on the verdict:

- `approve` → work item transitions to `approved`
- `needs-changes` → work item transitions to `needs-refinement`

## Acceptance Criteria

- [ ] Given the agent receives an enriched prompt with per-file diffs, when a changed file is a test
      file, then the agent reads the full test file before assessing test quality.
- [ ] Given the agent receives an enriched prompt with prior review comments (re-review scenario),
      when it reviews the revision, then it cross-references each prior comment against the current
      diff and records unaddressed items as findings.
- [ ] Given a re-review scenario where a prior review comment references a file that was not
      modified in the current diff, when the agent reviews the revision, then it investigates
      whether the feedback was addressed (by reading the file or checking the author's reply).
- [ ] Given a work item missing a required section (Scope, Acceptance Criteria, or Spec Reference),
      when the agent reviews the revision, then the review includes a warning for each affected
      checklist step and the remaining steps still run.
- [ ] Given a referenced spec file that does not exist or is not `status: approved`, when the agent
      reviews the revision, then the spec conformance step records a warning and the remaining steps
      still run.
- [ ] Given a work item with no Constraints section, when the agent reviews the revision, then the
      task constraints step records a warning and the remaining steps still run.
- [ ] Given a revision with unresolved review comments from prior reviews, when the agent reviews
      it, then it records unaddressed items as findings.
- [ ] Given a revision that modifies files outside primary scope where the modification qualifies as
      incidental, then the Reviewer does not flag it as a scope warning.
- [ ] Given a revision that modifies files outside primary scope where the modification does not
      qualify as incidental, then the Reviewer records a scope warning. The warning does not
      influence the verdict.
- [ ] Given a revision whose description contains a "Scope correction" section documenting a scope
      inaccuracy, when the Reviewer checks scope compliance, then files listed as the corrected
      scope are treated as effective primary scope and no scope warning is recorded for them.
- [ ] Given a revision that satisfies all checklist steps, when the agent produces its structured
      output, then the verdict is `approve` and the summary confirms approval.
- [ ] Given a revision that fails one or more acceptance criteria, when the agent produces a
      `needs-changes` verdict, then the comments include which criteria failed with an explanation
      for each failure.
- [ ] Given the agent produces a `needs-changes` verdict, when the review is examined, then each
      finding comment includes what is wrong, why it is wrong, and what needs to change.
- [ ] Given a revision with a spec deviation, when the agent produces a `needs-changes` verdict,
      then the comments reference the specific spec file and section.
- [ ] Given a revision that violates a task constraint, when the agent produces a `needs-changes`
      verdict, then the comments identify the constraint and explain the violation.
- [ ] Given a revision with code quality issues, when the agent produces a `needs-changes` verdict,
      then the comments reference specific files and lines with suggested improvements.
- [ ] Given a work item whose acceptance criteria contradict its own Constraints or Out of Scope
      boundaries, when the agent reviews the revision, then the contradictory criterion is recorded
      as a warning and is not used as grounds for rejection.
- [ ] Given the agent finishes execution (any outcome), then its structured output is a valid
      `ReviewerResult` matching the schema defined in
      `control-plane-engine-runtime-adapter-claude.md`.

## Dependencies

- [domain-model.md](./domain-model.md) — `ReviewerResult`, `AgentReview`, `AgentReviewComment`
  types, `ApplyReviewerResult` command.
- [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
  — Context assembly (enriched prompt format), `ReviewerOutputSchema` (Zod validation), agent
  definition loading, project context injection.
- [control-plane-engine-handlers.md](./control-plane-engine-handlers.md) — `handleReview` handler
  (dispatch trigger, result processing).
- `CLAUDE.md` — Code style, naming conventions, and patterns that the agent checks against.
- [workflow-contracts.md](./workflow-contracts.md) — Scope Enforcement Rules.
- Agent Bash Tool Validator — PreToolUse hook that validates all Bash commands against
  blocklist/allowlist before execution. See `agent-hook-bash-validator.md` (rules) and
  `agent-hook-bash-validator-script.md` (shell implementation).

## References

- [domain-model.md: Agent Results](./domain-model.md#agent-results) — `ReviewerResult`,
  `AgentReview`, `AgentReviewComment` type definitions.
- [control-plane-engine-runtime-adapter-claude.md: Reviewer Context](./control-plane-engine-runtime-adapter-claude.md#reviewer-context)
  — Enriched prompt format and data sources.
- [control-plane-engine-command-executor.md: ApplyReviewerResult](./control-plane-engine-command-executor.md#applyreviewerresult)
  — How the engine processes the reviewer's structured output.
- `docs/specs/decree/workflow.md` — Development Protocol (Reviewer role, Review Phase).
