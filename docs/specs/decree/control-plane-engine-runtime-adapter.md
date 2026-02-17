---
title: Control Plane Engine — Runtime Adapter
version: 0.1.0
last_updated: 2026-02-17
status: approved
---

# Control Plane Engine — Runtime Adapter

## Overview

The runtime adapter is the boundary between the engine and agent execution. It defines the contract
that any adapter implementation must satisfy — interface types, lifecycle invariants, context data
requirements, structured output validation, and execution environment constraints. The engine
programs against this contract; the runtime implementation is pluggable.

## Constraints

- Agents must not perform external writes — no git push, no label changes, no PR operations, no
  provider mutations. All external mutations are performed by the CommandExecutor after processing
  agent results.
- Execution environments created for agent sessions must be cleaned up on completion (success or
  failure). The patch is the durable artifact.
- Agent output must conform to the per-role structured output schema. Invalid output is treated as
  agent failure.
- Log writing failures are non-fatal — agent session behavior is unaffected. See
  [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md)
  for the normative definition.

## Specification

### RuntimeAdapter Interface

The interface is defined in
[002-architecture.md: Runtime Adapter](./v2/002-architecture.md#runtime-adapter). This spec adds
behavioral detail.

```ts
interface RuntimeAdapter {
  startAgent(params: AgentStartParams): Promise<AgentRunHandle>;
  cancelAgent(sessionID: string): void;
}
```

### AgentRunHandle

```ts
interface AgentRunHandle {
  output: AsyncIterable<string>;
  result: Promise<AgentResult>;
  logFilePath: string | null;
}
```

- `output` — live text stream of agent output for TUI display. Plain text, human-readable chunks. No
  binary data, tool metadata, or system messages. Ends when the session completes (success, failure,
  or cancellation).
- `result` — resolves with the parsed structured output on success. Rejects on failure (agent crash,
  timeout, invalid output, cancellation).
- `logFilePath` — path to the session log file when logging is enabled, `null` otherwise.

### AgentStartParams

Per-role discriminated union. Each role carries exactly the data it needs.

```ts
interface PlannerStartParams {
  role: "planner";
  specPaths: string[];
}

interface ImplementorStartParams {
  role: "implementor";
  workItemID: string;
  branchName: string;
}

interface ReviewerStartParams {
  role: "reviewer";
  workItemID: string;
  revisionID: string;
}

type AgentStartParams = PlannerStartParams | ImplementorStartParams | ReviewerStartParams;
```

### startAgent Lifecycle Contract

`startAgent(params: AgentStartParams): Promise<AgentRunHandle>`

Any conforming adapter must follow this abstract lifecycle:

1. **Provision execution environment.** Implementor requires an isolated environment where
   `branchName` from `ImplementorStartParams` is honored. Planner and Reviewer run against the
   default branch. If provisioning fails, reject the returned promise — no session is created.
2. **Assemble context.** Resolve `AgentStartParams` identifiers into enriched context. See
   [Context Assembly Data Requirements](#context-assembly-data-requirements). If any context data
   fetch fails, clean up the environment (if created) and reject.
3. **Run agent session.** Start the agent with the assembled context and per-role structured output
   schema.
4. **Track session for cancellation.** Record whatever handle is needed to support `cancelAgent`.
5. **Set up session logging.** If logging is enabled, begin writing session output. See
   [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md).
6. **Return handle.** Return an `AgentRunHandle` with `output` stream, `result` promise, and
   `logFilePath`.

The promise returned by `startAgent` resolves when the session is created and streaming begins
(steps 1–6 complete). It does not wait for the agent to finish — session monitoring and cleanup are
encapsulated in `handle.result`.

### cancelAgent Contract

`cancelAgent(sessionID: string): void`

Cancellation causes:

- The agent session to terminate.
- The `handle.result` promise to reject.
- The output stream to end.
- Execution environment cleanup (if applicable) to execute.

If no session is tracked for the given `sessionID`, this is a no-op.

### Execution Environment Requirements

| Role        | Environment                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------- |
| Implementor | Isolated environment where `branchName` from start params is honored as the working branch. |
| Planner     | Default branch (repository root).                                                           |
| Reviewer    | Default branch (repository root).                                                           |

Cleanup on completion or failure is mandatory — execution environments are disposable. For
Implementor, the patch extracted from the environment is the durable artifact.

### Context Assembly Data Requirements

Adapters must resolve `AgentStartParams` identifiers into enriched context before running the agent.
The tables below specify **what** data each role needs, not the prompt format.

#### Planner

| Data                 | Source                                                                                         | Notes                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Spec file content    | Filesystem read at each path in `specPaths`                                                    | Read for every path                                        |
| Change type per spec | `getState().lastPlannedSHAs`                                                                   | No entry = added. Entry with different blobSHA = modified. |
| Spec diffs           | Derived from `lastPlannedSHAs` blob SHAs — old content vs current file                         | Skipped for added specs                                    |
| Existing work items  | `getState().workItems` for id/title/status; `deps.workItemReader.getWorkItemBody(id)` for body | All work items in the state store                          |

#### Implementor

| Data               | Source                                             | Condition                   |
| ------------------ | -------------------------------------------------- | --------------------------- |
| Work item body     | `deps.workItemReader.getWorkItemBody(workItemID)`  | Always                      |
| Work item metadata | `getState().workItems[workItemID]`                 | Always (title, status)      |
| Revision metadata  | `getState().revisions[revisionID]`                 | When linked revision exists |
| Revision files     | `deps.revisionReader.getRevisionFiles(revisionID)` | When linked revision exists |
| Review history     | `deps.getReviewHistory(revisionID)`                | When linked revision exists |
| CI status          | `getState().revisions[revisionID].pipeline`        | When linked revision exists |

The adapter checks `getState().workItems[workItemID].linkedRevision` to determine whether revision
context is included.

#### Reviewer

| Data               | Source                                             | Notes         |
| ------------------ | -------------------------------------------------- | ------------- |
| Work item body     | `deps.workItemReader.getWorkItemBody(workItemID)`  | Always        |
| Work item metadata | `getState().workItems[workItemID]`                 | Title, status |
| Revision metadata  | `getState().revisions[revisionID]`                 | Title         |
| Revision files     | `deps.revisionReader.getRevisionFiles(revisionID)` | Always        |
| Review history     | `deps.getReviewHistory(revisionID)`                | Always        |

#### Error Handling

If any context data fetch fails, the `startAgent` promise rejects. This is treated as a provisioning
failure — the `startAgentAsync` lifecycle in the CommandExecutor enqueues a `*Failed` event.

### Patch Extraction Contract

For Implementor sessions with outcome `completed`, the adapter must produce a non-empty unified diff
from the execution environment. This patch becomes the `patch` field in the `ImplementorResult`.

- Empty patch (agent reported completed but made no changes) is treated as agent failure —
  `handle.result` rejects.
- Non-completed outcomes (`blocked`, `validation-failure`) skip extraction — `patch` is `null`.

### Structured Output Validation

Agents must produce output conforming to the per-role `AgentResult` types defined in
[002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results). The adapter is
responsible for the validation mechanism. Invalid output is treated as agent failure —
`handle.result` rejects.

For Implementor: the agent's direct output omits the `patch` field (which is adapter-extracted). The
adapter enriches the validated agent output with the extracted patch to produce the full
`ImplementorResult`.

### Duration Timeout

Adapters must enforce a configurable maximum session duration (`config.maxAgentDuration` seconds).
Timeout is treated as agent failure — `handle.result` rejects.

### Session Logging

When `config.logging.agentSessions` is enabled, the adapter writes session transcripts to disk. Log
format, file lifecycle, error handling, and log file path computation are defined in
[control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md).

### RuntimeAdapterDeps

Universal dependency interface — what the engine provides to any adapter factory.

```ts
interface RuntimeAdapterDeps {
  workItemReader: WorkProviderReader;
  revisionReader: RevisionProviderReader;
  getState: () => EngineState;
  getReviewHistory: (revisionID: string) => Promise<ReviewHistory>;
}
```

### RuntimeAdapterConfig

Base configuration type with mandatory fields. Implementation configs extend this with
adapter-specific fields.

```ts
interface RuntimeAdapterConfig {
  maxAgentDuration: number; // seconds
  logging: {
    agentSessions: boolean;
    logsDir: string; // absolute path
  };
}
```

### ReviewHistory

Types used by context assembly for review history fetching. Owned by this module.

```ts
interface ReviewHistory {
  reviews: ReviewSubmission[];
  inlineComments: ReviewInlineComment[];
}

interface ReviewSubmission {
  author: string;
  state: string;
  body: string;
}

interface ReviewInlineComment {
  path: string;
  line: number | null;
  author: string;
  body: string;
}
```

The `getReviewHistory` function in `RuntimeAdapterDeps` returns review data for a given revision.
The engine wiring provides an implementation backed by the provider's capabilities.

### Type Definitions

The following types are owned by this module and live in `engine/runtime-adapter/types.ts`:

- `RuntimeAdapter`
- `AgentRunHandle`
- `AgentStartParams` (and per-role variants: `PlannerStartParams`, `ImplementorStartParams`,
  `ReviewerStartParams`)
- `RuntimeAdapterDeps`
- `RuntimeAdapterConfig`
- `ReviewHistory`, `ReviewSubmission`, `ReviewInlineComment`

**Type migration.** `RuntimeAdapter`, `AgentRunHandle`, and `AgentStartParams` (per-role variants)
are currently defined in `engine/command-executor/types.ts` as temporarily hosted types. When this
module is implemented, move these types to `engine/runtime-adapter/types.ts` and update imports in
the command executor.

### Module Location

> **v2 module.** This is new v2 code in `engine/runtime-adapter/`, implemented alongside the v1
> agent manager (`engine/agent-manager/`). The v1 module continues to function on `main` until the
> engine replacement (migration plan Step 8). Do not modify or delete v1 modules when implementing
> this spec.

Core types live in `engine/runtime-adapter/types.ts`. Implementation files are adapter-specific —
see the Claude adapter spec for the Claude SDK file layout.

## Acceptance Criteria

### startAgent Lifecycle

- [ ] Given `startAgent` is called with `ImplementorStartParams`, when environment provisioning
      fails, then the promise rejects and no agent session is created.
- [ ] Given `startAgent` is called for any role, when a context assembly fetch fails (spec read,
      work item body, revision files), then the promise rejects and any created environment is
      cleaned up.
- [ ] Given `startAgent` is called for any role, when the session is created, then `handle.output`
      begins yielding plain text chunks and `handle.result` is pending.
- [ ] Given `startAgent` resolves, when the agent later completes successfully, then `handle.result`
      resolves with a valid `AgentResult` for the role.
- [ ] Given `startAgent` resolves, when the agent later fails, then `handle.result` rejects.

### cancelAgent

- [ ] Given a running agent session, when `cancelAgent` is called with its session ID, then the
      session terminates, `handle.result` rejects, and the output stream ends.
- [ ] Given `cancelAgent` is called with an unknown session ID, when the call executes, then it is a
      no-op.

### Execution Environment

- [ ] Given an Implementor session starts, when the environment is provisioned, then the agent
      operates on a branch matching `branchName` from the start params.
- [ ] Given an Implementor session completes (success or failure), when cleanup runs, then the
      execution environment is removed.
- [ ] Given a Planner session starts, when the environment is configured, then the agent operates
      against the default branch.
- [ ] Given a Reviewer session starts, when the environment is configured, then the agent operates
      against the default branch.

### Context Assembly — Planner

- [ ] Given `startAgent` is called with `PlannerStartParams` containing two spec paths, when context
      is assembled, then the adapter fetches content for both specs.
- [ ] Given a spec path has no entry in `lastPlannedSHAs`, when context is assembled, then the spec
      is classified as added (no diff).
- [ ] Given a spec path has an entry in `lastPlannedSHAs` with a different blobSHA, when context is
      assembled, then the spec is classified as modified (diff included).
- [ ] Given existing work items in the state store, when planner context is assembled, then the
      adapter fetches id, title, status, and body for each work item.

### Context Assembly — Implementor

- [ ] Given an Implementor session for a work item with no linked revision, when context is
      assembled, then only work item data is fetched (no revision, reviews, or CI data).
- [ ] Given an Implementor session for a work item with a linked revision, when context is
      assembled, then revision files and review history are fetched.
- [ ] Given an Implementor session for a work item whose linked revision has `pipeline.status` of
      `failure`, when context is assembled, then CI failure data is included.
- [ ] Given an Implementor session for a work item whose linked revision has `pipeline.status` of
      `success`, when context is assembled, then no CI failure data is included.

### Context Assembly — Reviewer

- [ ] Given a Reviewer session, when context is assembled, then work item body, revision files, and
      review history are fetched.

### Patch Extraction

- [ ] Given an Implementor session completes with outcome `completed`, when the adapter extracts the
      patch, then `handle.result` resolves with an `ImplementorResult` whose `patch` is a non-empty
      unified diff string.
- [ ] Given an Implementor session completes with outcome `completed` but the environment has no
      changes, when extraction runs, then `handle.result` rejects (empty patch treated as failure).
- [ ] Given an Implementor session completes with outcome `blocked`, when result assembly runs, then
      `patch` is `null` and no extraction is attempted.

### Structured Output

- [ ] Given an agent session completes with valid structured output matching the role's schema, when
      validation runs, then `handle.result` resolves with the correctly typed result.
- [ ] Given an agent session produces invalid structured output, when validation runs, then
      `handle.result` rejects.
- [ ] Given an Implementor session completes with valid output, when result assembly runs, then the
      adapter enriches the agent output with the extracted patch to produce the full
      `ImplementorResult`.

### Duration Timeout

- [ ] Given `maxAgentDuration` is configured, when an agent session exceeds the duration, then the
      session is cancelled and `handle.result` rejects.

### Output Stream

- [ ] Given a running agent session, when text output is produced, then `handle.output` yields plain
      text chunks with no binary data, tool metadata, or system messages.
- [ ] Given an agent session completes, when the session ends, then the output stream completes.
- [ ] Given an agent session is cancelled, when cancellation occurs, then the output stream
      completes.

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — `RuntimeAdapter` interface, `AgentRunHandle`,
  `AgentStartParams` (per-role), `AgentResult` types, mutation boundary contract.
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) —
  `startAgentAsync` lifecycle (consumer of `RuntimeAdapter`).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `lastPlannedSHAs`, selectors.
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `WorkProviderReader`, `RevisionProviderReader` interfaces.
- [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md) —
  Agent session transcript logging.

## References

- [002-architecture.md: Runtime Adapter](./v2/002-architecture.md#runtime-adapter) — Interface,
  mutation boundary, worktree management, agent run lifecycle.
- [002-architecture.md: Agent Role Contracts](./v2/002-architecture.md#agent-role-contracts) —
  Shared patterns, per-role context requirements.
- [002-architecture.md: Agent Results](./v2/002-architecture.md#agent-results) — Structured output
  types (`PlannerResult`, `ImplementorResult`, `ReviewerResult`, `AgentReview`).
- [control-plane-engine-command-executor.md: startAgentAsync](./control-plane-engine-command-executor.md#startagentasync)
  — Async lifecycle manager that consumes `AgentRunHandle`.
