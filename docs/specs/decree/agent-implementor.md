---
title: Implementor Agent
version: 1.0.0
last_updated: 2026-02-19
status: approved
---

# Implementor Agent

## Overview

Agent that executes assigned work items by reading the work item body and referenced specs, writing
code and tests within declared scope, and surfacing blockers when it cannot proceed. An Implementor
works on one work item at a time; parallelism is achieved by running multiple Implementor instances,
not by assigning multiple work items to one agent.

The Implementor produces structured output only. It does not push branches, open revisions, post
comments, or change work item status. All external mutations are performed by the engine after
processing the agent's result. See [domain-model.md: Implementor](./domain-model.md#implementor) for
the role contract.

## Constraints

- Must work on exactly one work item at a time.
- Must not perform any GitHub operations — no `gh` CLI, no `gh.sh`, no API calls. All external
  mutations (revision creation, status transitions, comments) are performed by the engine's
  CommandExecutor after processing the agent's `ImplementorResult`.
- Must not push branches or create revisions. Code changes are committed locally in the worktree;
  the runtime adapter extracts a patch artifact after the session completes.
- Must not change work item status labels. Status transitions (`ready` to `in-progress`, etc.) are
  handled reactively by engine handlers in response to agent lifecycle events.
- Must conform to the project's code style, naming conventions, and patterns defined in `CLAUDE.md`.
- Must use conventional commit format for commit messages.
- Must not reprioritize work items or change sequencing. Executes what is assigned.
- Must not make interpretive decisions when the spec is ambiguous, contradictory, or incomplete.
  Report the blocker in the structured output instead.
- The agent definition body must include the permitted bash command list from
  [agent-hook-bash-validator.md: Allowlist Prefixes](./agent-hook-bash-validator.md#allowlist-prefixes)
  to prevent wasted turns on blocked commands.
- When debugging a test or validation failure, re-reading a file the agent has already read in the
  current session indicates the failure exceeds the agent's ability to resolve efficiently. The
  agent must report a blocker (outcome: `validation-failure`) rather than re-reading files to trace
  a failure.

## Agent Profile

| Constraint       | Value                                            | Rationale                                                                               |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Model tier       | Opus (default)                                   | Implementation requires strong reasoning; overridden by engine based on task complexity |
| Tool access      | Full write (Read, Write, Edit, Grep, Glob, Bash) | Must create and modify source code and tests                                            |
| Turn budget      | 100                                              | Open-ended implementation work requires higher budget than analysis                     |
| Permission model | Non-interactive with bash validation             | Runs unattended; bash validator enforces command safety                                 |

The agent definition (`.claude/agents/implementor.md`) implements these constraints as frontmatter.
See
[control-plane-engine-runtime-adapter-claude.md: Agent Definition Loading](./control-plane-engine-runtime-adapter-claude.md#agent-definition-loading)
for how the runtime adapter parses frontmatter.

## Trigger

The Implementor is dispatched when a work item transitions to `ready` status. The engine's
`handleImplementation` handler emits `RequestImplementorRun` in response to `WorkItemChanged`
events. See
[control-plane-engine-handlers.md: handleImplementation](./control-plane-engine-handlers.md#handleimplementation)
for dispatch logic.

The agent receives the work item in one of two contexts:

1. **New implementation** — No linked revision exists. The agent implements the work item from
   scratch.
2. **Resume** — A linked revision exists (from a prior run that was blocked, failed validation, or
   was rejected by the reviewer). The enriched prompt includes revision files, CI status, and prior
   review history.

The agent determines the context from the presence or absence of a revision section in its enriched
prompt.

## Inputs

The runtime adapter assembles an enriched trigger prompt from
`ImplementorStartParams { workItemID, branchName }`. See
[control-plane-engine-runtime-adapter-claude.md: Implementor Context](./control-plane-engine-runtime-adapter-claude.md#implementor-context)
for the prompt format and data resolution.

1. **Trigger prompt:** An enriched prompt containing the work item details (ID, title, body,
   status). When a linked revision exists (resume scenarios), the prompt additionally includes
   per-file revision diffs, CI failure details (when pipeline has failed), and prior review history.
2. **Project context:** CLAUDE.md content (coding conventions, style rules, architecture) appended
   to the agent's system prompt. See
   [control-plane-engine-runtime-adapter-claude.md: Project Context Injection](./control-plane-engine-runtime-adapter-claude.md#project-context-injection).
3. **Working directory:** A git worktree on a fresh branch based on `defaultBranch`. The branch name
   is assigned by the engine — the agent works on whatever branch its worktree starts on. See
   [control-plane-engine-runtime-adapter-claude.md: Worktree Management](./control-plane-engine-runtime-adapter-claude.md#worktree-management).

The agent fetches remaining data via tool calls: referenced spec sections and in-scope file state.
The work item body, revision diffs, and review comments are pre-computed in the trigger prompt.

## Execution

### Implementation Workflow

Regardless of context (new or resume), the agent follows this workflow:

1. **Understand the assignment.** Read the work item body from the enriched prompt. Identify the
   objective, spec reference, scope boundaries, acceptance criteria, and constraints.

2. **Read referenced specs.** Fetch the spec file and relevant sections via tool calls. The spec
   content is not included in the enriched prompt — the agent reads it from disk.

3. **Assess resume context** (resume only). When the enriched prompt includes revision files and
   prior review history, review them to understand:
   - What code changes already exist.
   - What review feedback needs to be addressed.
   - What CI failures need to be fixed.

4. **Implement.** Write code and tests within the declared scope. Commit changes locally using
   conventional commit format. The agent may make multiple commits during a session.

5. **Validate.** Run pre-submit validation (lint, format, typecheck, tests) before completing. See
   [Pre-submit Validation](#pre-submit-validation).

6. **Produce structured output.** Return an `ImplementorResult` via the SDK's structured output
   mechanism. See [Structured Output](#structured-output).

### Pre-submit Validation

The agent runs the project's validation suite before completing. The specific commands are defined
in `CLAUDE.md` (typically `yarn check` or equivalent).

- **Validation passes:** The agent proceeds to produce a `completed` outcome.
- **Validation fails due to the agent's changes:** The agent fixes the issues and re-runs
  validation.
- **Validation fails due to something outside the agent's scope** (pre-existing failure, broken
  dependency, infrastructure issue): The agent produces a `validation-failure` outcome with a
  summary describing the external failure.
- **Repeated re-reads during debugging:** If the agent re-reads a file it has already read in the
  current session while debugging a validation failure, it must stop and produce a
  `validation-failure` outcome rather than continuing to loop.

### Scope Enforcement

The agent must only modify files listed in the work item's "In Scope" section, subject to the scope
enforcement rules defined in
[workflow-contracts.md: Scope Enforcement Rules](./workflow-contracts.md#scope-enforcement-rules)
(primary scope, co-located test files, incidental changes, scope inaccuracy).

When non-incidental changes to out-of-scope files are needed:

- If it blocks progress: produce a `blocked` outcome with a summary describing the scope constraint.
  Include the blocker type (`technical-constraint`) in the summary text.
- If it does not block progress: note the scope conflict in the summary and continue with in-scope
  work.

When the In Scope list names a file that does not contain the expected code:

- If the task intent is unambiguous and the correct target is identifiable from the codebase: the
  agent determines the correct target file, treats it as effective primary scope, and documents the
  discrepancy in a commit message.
- If the discrepancy makes the task intent unclear: produce a `blocked` outcome. Include the blocker
  type (`spec-gap`) in the summary text.

## Blocker Handling

When the agent encounters something that prevents continued progress, it stops work and produces a
structured output with the appropriate outcome. The agent does not post comments, open draft PRs, or
change labels — all of that is handled by the engine.

| Blocker type                                | Outcome              | Summary content                                                        |
| ------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Spec ambiguity, contradiction, or gap       | `blocked`            | Blocker type, description, spec reference, options, and recommendation |
| External dependency or technical constraint | `blocked`            | Blocker type, description, what was attempted, and impact              |
| Debugging limit (re-reading files)          | `validation-failure` | Description of the failure and what was attempted before stopping      |
| Pre-existing validation failure             | `validation-failure` | Which validation step failed and why it is outside the agent's scope   |

The `summary` field carries blocker information (type label, description, options, recommendation,
impact) as plain text. Blocker type is not a separate schema field — it is embedded in the summary
text (e.g., "Type: spec-gap — …"). The engine's `ApplyImplementorResult` command handles
outcome-dependent operations — transitioning status to `blocked` or `needs-refinement`, and
including the summary in the work item update if needed.

## Structured Output

The agent produces an `ImplementorResult` as its structured output on every run. The runtime adapter
validates this against a Zod schema and enriches it with the extracted patch. See
[control-plane-engine-runtime-adapter-claude.md: Structured Output](./control-plane-engine-runtime-adapter-claude.md#structured-output)
for the schema and validation process.

The agent outputs:

```
{
  "role": "implementor",
  "outcome": "completed" | "blocked" | "validation-failure",
  "summary": "<what was done, or why it could not be done>"
}
```

The `patch` field in the full `ImplementorResult` is not agent-produced — the runtime adapter
extracts it from the worktree via `git diff` after the session completes. See
[control-plane-engine-runtime-adapter-claude.md: Patch Extraction](./control-plane-engine-runtime-adapter-claude.md#patch-extraction).

### Outcome Semantics

| Outcome              | Meaning                                                                                  | Engine response                                     |
| -------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `completed`          | Work item fully implemented and validated. Worktree contains committable changes.        | Create revision from patch, transition to `review`. |
| `blocked`            | Progress prevented by an issue outside the agent's control (spec, dependency, scope).    | Transition to `blocked`.                            |
| `validation-failure` | Pre-submit validation failed due to something outside the agent's scope or debug limits. | Transition to `needs-refinement`.                   |

The engine processes outcomes via `ApplyImplementorResult`. See
[domain-model.md: Implementor](./domain-model.md#implementor) for the full status flow.

### Summary Guidelines

The `summary` field serves two audiences: the engine (for status transitions and work item updates)
and the human operator (for understanding what happened). Content varies by outcome:

- **`completed`:** Brief description of what was implemented and tested.
- **`blocked`:** Structured blocker information — type, description, spec reference (for spec
  blockers), options with trade-offs, recommendation, and impact.
- **`validation-failure`:** Which validation step failed, what the agent tried, and why the failure
  is outside its scope.

## Acceptance Criteria

- [ ] Given a work item with a "Spec Reference" field, when the agent starts work, then it reads the
      referenced spec file and sections via tool calls before writing code.
- [ ] Given a work item with an "In Scope" file list, when the agent completes work, then only files
      in primary scope, co-located test files, incidental changes, and documented scope inaccuracies
      have been modified.
- [ ] Given a work item whose In Scope list names a file that does not contain the expected code,
      when the task intent is unambiguous, then the agent determines the correct target file and
      proceeds with implementation.
- [ ] Given a work item whose In Scope list names a file that does not contain the expected code,
      when the discrepancy makes the task intent unclear, then the agent produces a `blocked`
      outcome.
- [ ] Given a satisfiable work item, when the agent completes work, then the structured output has
      outcome `completed` and the worktree contains committed changes against the branch.
- [ ] Given a spec ambiguity during implementation, when the agent stops work, then the structured
      output has outcome `blocked` with a summary describing the spec issue, options, and
      recommendation.
- [ ] Given a non-spec blocker during implementation, when the agent stops work, then the structured
      output has outcome `blocked` with a summary describing the constraint and impact.
- [ ] Given a validation failure outside the agent's scope, when the agent stops work, then the
      structured output has outcome `validation-failure` with a summary identifying the external
      failure.
- [ ] Given the agent re-reads a file during validation debugging, when the re-read is detected,
      then the agent stops and produces a `validation-failure` outcome instead of continuing to
      loop.
- [ ] Given an enriched prompt with revision files and prior review history (resume scenario), when
      the agent starts work, then it reviews the existing changes and feedback before making new
      modifications.
- [ ] Given an enriched prompt with a CI failure section (resume scenario), when the agent starts
      work, then it addresses the CI failure as part of its implementation.
- [ ] Given a review comment requesting changes to out-of-scope files, when the change does not
      block progress, then the agent notes the scope conflict in the summary and continues with
      in-scope work.
- [ ] Given a non-incidental change needed to an out-of-scope file that blocks progress, when the
      agent stops work, then the structured output has outcome `blocked` with a summary identifying
      the blocker type as `technical-constraint`.
- [ ] Given the agent finishes execution (any outcome), then its structured output matches the
      `ImplementorResult` schema with `role: 'implementor'`, a valid outcome, and a non-empty
      summary.
- [ ] Given the agent finishes execution, then it has not performed any GitHub CLI operations, has
      not pushed any branches, and has not opened any revisions.

## Dependencies

- `CLAUDE.md` — Code style, naming conventions, and patterns that the agent must conform to.
- Project testing framework — Tests must be runnable locally via the commands defined in
  `CLAUDE.md`.
- [workflow-contracts.md](./workflow-contracts.md) — Scope Enforcement Rules.
- [agent-hook-bash-validator.md](./agent-hook-bash-validator.md) — PreToolUse hook that validates
  all Bash commands against blocklist/allowlist before execution.
- [control-plane-engine-runtime-adapter-claude.md](./control-plane-engine-runtime-adapter-claude.md)
  — Context assembly (enriched prompt format), worktree management, patch extraction, structured
  output validation.
- [domain-model.md](./domain-model.md) — `ImplementorResult` type definition, Implementor role
  contract, `ApplyImplementorResult` command semantics.

## References

- [domain-model.md: Implementor](./domain-model.md#implementor) — Role contract, status flow,
  concurrency.
- [domain-model.md: Agent Results](./domain-model.md#agent-results) — `ImplementorResult` type
  definition.
- [control-plane-engine-handlers.md: handleImplementation](./control-plane-engine-handlers.md#handleimplementation)
  — Dispatch and result processing logic.
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) —
  `ApplyImplementorResult` execution (revision creation, status transitions).
- [workflow.md](./workflow.md) — Development Protocol (Implementor role, Implementation Phase).
