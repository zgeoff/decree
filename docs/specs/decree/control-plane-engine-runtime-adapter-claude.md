---
title: Control Plane Engine — Runtime Adapter (Claude)
version: 0.2.0
last_updated: 2026-02-18
status: approved
---

# Control Plane Engine — Runtime Adapter (Claude)

## Overview

The Claude runtime adapter implements the `RuntimeAdapter` interface using the Claude Agent SDK. It
owns all interaction with `@anthropic-ai/claude-agent-sdk` and `gray-matter`, keeping SDK specifics
isolated from the rest of the engine. The adapter handles git worktree management, context assembly
(resolving minimal `AgentStartParams` identifiers into enriched prompts), agent definition loading,
structured output validation via Zod, live output streaming, and session logging.

## Constraints

- No file outside `engine/runtime-adapter/` may import from `@anthropic-ai/claude-agent-sdk` or
  `gray-matter`.
- The adapter must satisfy the mutation boundary, execution environment, and lifecycle contracts
  defined in [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md).
- Worktrees and local branches created for agent sessions must be removed on completion (success or
  failure). The patch is the durable artifact — `RevisionProviderWriter.createFromPatch` operates
  entirely via the GitHub API.

## Specification

### createClaudeAdapter

```ts
// Narrowed hook callback type — avoids leaking SDK types outside the adapter module
type BashValidatorHook = (event: {
  tool_name: string;
  tool_input: Record<string, unknown>;
}) => Promise<HookResponse | undefined>;

interface ClaudeAdapterConfig extends RuntimeAdapterConfig {
  repoRoot: string;
  defaultBranch: string; // base branch for worktree creation and patch extraction (e.g., 'main')
  contextPaths: string[]; // paths relative to repoRoot (see Project Context Injection)
  bashValidatorHook: BashValidatorHook; // PreToolUse hook for Bash command validation
  logger: Logger; // adapter-internal logging (session lifecycle, errors, diagnostics)
}

createClaudeAdapter(config: ClaudeAdapterConfig, deps: RuntimeAdapterDeps): RuntimeAdapter
```

The factory returns a `RuntimeAdapter`. It loads agent definitions and project context lazily on
each `startAgent` call — no caching.

> **Rationale:** Lazy loading ensures agent definitions and project context reflect the latest
> on-disk state without requiring a cache invalidation mechanism.

### startAgent

`startAgent(params: AgentStartParams): Promise<AgentRunHandle>`

The primary entry point for launching agent sessions. Follows the lifecycle contract defined in
[control-plane-engine-runtime-adapter.md: startAgent Lifecycle Contract](./control-plane-engine-runtime-adapter.md#startagent-lifecycle-contract):

1. **Worktree setup** (Implementor only). Create a worktree for the agent's working directory. See
   [Worktree Management](#worktree-management). If worktree setup fails, reject the returned promise
   — no session is created.

2. **Context assembly**. Resolve `AgentStartParams` (minimal identifiers) into an enriched trigger
   prompt. See [Context Assembly](#context-assembly). If context assembly fails, clean up the
   worktree (if created) and reject.

3. **Agent definition loading**. Read the agent definition file from `.claude/agents/<role>.md`. See
   [Agent Definition Loading](#agent-definition-loading). If loading fails, clean up and reject.

4. **SDK session creation**. Create the agent session via `query()` from
   `@anthropic-ai/claude-agent-sdk`. See [SDK Session Configuration](#sdk-session-configuration).

5. **Session tracking**. Record the session's `AbortController` keyed by session identifier for
   cancellation support.

6. **Log file setup**. If logging is enabled, compute the log file path and begin writing session
   output. See [Agent Session Logging](#agent-session-logging).

7. **Return handle**. Return an `AgentRunHandle` with:
   - `output` — an `AsyncIterable<string>` that streams live agent text output. See
     [Output Stream](#output-stream).
   - `result` — a `Promise<AgentResult>` that monitors the session. On completion: validates
     structured output via Zod (see [Structured Output](#structured-output)), extracts the patch for
     Implementor sessions (see [Patch Extraction](#patch-extraction)), assembles the full
     `AgentResult`, cleans up the worktree, and resolves.
   - `logFilePath` — the log file path (or `null` if logging is disabled).

The promise returned by `startAgent` resolves when the SDK session is created and streaming begins
(steps 1–7 complete). It does not wait for the agent to finish — session monitoring and cleanup are
encapsulated in `handle.result`.

### cancelAgent

`cancelAgent(sessionID: string): void`

Aborts the agent session by calling `abort()` on the `AbortController` associated with the session.
If no session is tracked for the given `sessionID`, this is a no-op.

Cancellation causes:

- The SDK session to terminate.
- The `handle.result` promise to reject.
- The output stream to end.
- Worktree cleanup (Implementor) to execute.

### Worktree Management

Worktrees provide isolated working directories for Implementor sessions. Worktree lifecycle is an
adapter concern — the engine does not know about worktrees.

#### Implementor Worktree

The adapter creates a worktree for Implementor sessions. The `branchName` is provided in
`ImplementorStartParams`.

1. If a worktree already exists at `.worktrees/<branchName>` (stale from a previous interrupted
   run), remove it via `git worktree remove --force`. If removal of the stale worktree fails, the
   `startAgent` promise rejects with the underlying error.
2. Create the worktree with a fresh branch:
   `git worktree add .worktrees/<branchName> -B <branchName> <defaultBranch>` (where `defaultBranch`
   comes from the engine config).
3. Run `yarn install` in the worktree directory. If `yarn install` fails, remove the worktree and
   fail the `startAgent` call.
4. Set `cwd` for the SDK session to `.worktrees/<branchName>`.

> **Rationale:** Yarn PnP requires the install/link step in each worktree for platform-specific
> binaries (turbo, esbuild) and module resolution (`.pnp.cjs`) to work. Without it, agents cannot
> run typechecking, tests, or builds. The `-B` flag force-creates the branch (resetting to `main` if
> it already exists), ensuring a clean starting point for each run.

**Cleanup:** When the agent session completes (success or failure) — after patch extraction for
successful runs (see [Patch Extraction](#patch-extraction)) — remove the worktree and delete the
local branch via `git worktree remove` and `git branch -D <branchName>`. Both are disposable — the
patch is the durable artifact. `RevisionProviderWriter.createFromPatch` operates entirely via the
GitHub API and does not use the local branch.

> **Rationale:** The v2 artifact model replaces v1's branch-as-artifact approach. The agent works in
> the worktree, the adapter extracts a patch, and the provider writer creates the remote branch and
> PR from the patch via GitHub's Git Data API. No local branch state is needed after extraction.

#### Planner and Reviewer Working Directory

Planner and Reviewer sessions do not require worktrees. The adapter sets `cwd` to the repository
root.

> **Rationale:** The planner operates on spec content and work item metadata — no code generation.
> The reviewer produces a structured review artifact from diffs provided in context — no local code
> access beyond the default branch is needed.

### Patch Extraction

When an Implementor session completes with outcome `completed`, the adapter extracts a unified diff
from the worktree before cleanup. This patch becomes the `patch` field in the `ImplementorResult`
passed to the engine via `handle.result`.

1. After the agent session ends, check the agent's structured output for `outcome: 'completed'`.
2. Run `git diff <defaultBranch>..HEAD` in the worktree directory to produce a unified diff of all
   changes (where `defaultBranch` comes from the engine config).
3. If the diff is empty (agent reported completed but made no changes), treat as agent failure —
   reject `handle.result`.
4. Store the patch string. Proceed to worktree cleanup.

For non-completed outcomes (`blocked`, `validation-failure`), skip patch extraction — `patch` is
`null` in the result.

> **Rationale:** The patch is the agent's durable artifact in the v2 model. Extracting it in the
> adapter keeps the agent's structured output lightweight (outcome + summary only) while the full
> diff is captured programmatically. This avoids requiring agents to produce raw diffs as JSON
> string fields.

### Context Assembly

The adapter resolves `AgentStartParams` (minimal identifiers) into enriched trigger prompts. Each
role receives context tailored to its task. The data requirements are defined in
[control-plane-engine-runtime-adapter.md: Context Assembly Data Requirements](./control-plane-engine-runtime-adapter.md#context-assembly-data-requirements)
— this section specifies the prompt format.

#### Planner Context

Input: `PlannerStartParams { role: 'planner', specPaths: string[] }`.

**Enriched prompt format:**

```
## Changed Specs

### <filePath> (added)
<full file content>

### <filePath> (modified)
<full file content>

#### Diff
<unified diff>

## Existing Work Items

### WorkItem #<id> — <title>
Status: <status>

<body>
```

**Data resolution:**

| Data                | Resolution                                                                                     | Notes                                               |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Spec content        | Filesystem read at `config.repoRoot/<filePath>`                                                | Read for every path in `specPaths`                  |
| Change type         | `getState().lastPlannedSHAs`                                                                   | No entry = `added`. Different blobSHA = `modified`. |
| Spec diffs          | `git show <lastPlannedBlobSHA>` for old content, unified diff against current file             | Skipped for added specs                             |
| Existing work items | `getState().workItems` for id/title/status; `deps.workItemReader.getWorkItemBody(id)` for body | All work items in the state store                   |

For added specs, only the full content is included (no diff). For modified specs, the full content
is followed by a unified diff showing changes since the last planned version.

> **Rationale:** Pre-computing diffs saves the Planner tool-call turns for data gathering. The
> adapter reads specs from the local filesystem — this is cheap and avoids GitHub API calls. The
> `lastPlannedSHAs` blob SHAs identify the previously planned version: `git show <blobSHA>`
> retrieves the old content for diffing.

**Error handling:** If any spec file read or work item body fetch fails, the `startAgent` promise
rejects (treated as provisioning failure).

#### Implementor Context

Input: `ImplementorStartParams { role: 'implementor', workItemID: string, branchName: string }`.

The adapter reads `revisionID = getState().workItems[workItemID].linkedRevision` to determine the
prompt tier:

- **No linked revision:** Prompt includes work item details only.
- **Linked revision exists:** Prompt additionally includes revision files, review history, and CI
  status (when pipeline has failed).

**Enriched prompt format — no linked revision:**

```
## Work Item #<id> — <title>

<body>

### Status
<status>
```

**Enriched prompt format — linked revision:**

```
## Work Item #<id> — <title>

<body>

### Status
<status>

## Revision #<revisionID> — <title>

### Changed Files

#### <path> (<status>)
```

<patch>
```

### CI Status: FAILURE

<pipeline.reason>: <pipeline.url>

### Prior Reviews

#### Review by <author> — <state>

<body>

### Prior Inline Comments

#### <path>:<line> — <author>

<body>
```

For files with no `patch` (binary files or diff size limit), the file entry includes the path and
status but no code block. When no prior reviews or inline comments exist, those sections are
omitted. The "CI Status" section is included only when `revision.pipeline.status` is `failure` —
omitted for `success` or `pending`.

> **Rationale:** Pre-computing the work item body eliminates a tool-call turn every Implementor
> invocation requires. For resume scenarios, pre-computing revision files and review comments is
> particularly valuable for `needs-refinement` where understanding review feedback is the first
> step.

**Error handling:** If any fetch fails, the `startAgent` promise rejects.

#### Reviewer Context

Input: `ReviewerStartParams { role: 'reviewer', workItemID: string, revisionID: string }`.

**Enriched prompt format:**

```
## Work Item #<id> — <title>

<body>

### Status
<status>

## Revision #<revisionID> — <title>

### Changed Files

#### <path> (<status>)
```

<patch>
```

### Prior Reviews

#### Review by <author> — <state>

<body>

### Prior Inline Comments

#### <path>:<line> — <author>

<body>
```

For files with no `patch`, the file entry includes the path and status but no code block. For
first-time reviews with no prior review history, the "Prior Reviews" and "Prior Inline Comments"
sections are omitted.

**Error handling:** If any fetch fails, the `startAgent` promise rejects.

### Agent Definition Loading

The adapter reads agent definition files from `.claude/agents/<role>.md` at the repository root and
passes them inline to the SDK.

> **Rationale:** This is part of the workaround for the SDK's worktree resolution bug — agent
> definitions are loaded from the repository root, which always has a `.git` directory. See
> [Known Limitations](#known-limitations).

**Loading process:**

1. Read `{config.repoRoot}/.claude/agents/{role}.md` from disk.
2. Parse the file's YAML frontmatter using `gray-matter`.
3. Extract fields from frontmatter. See field mapping table below.
4. The markdown body (after frontmatter) becomes the agent's `prompt` (system prompt).
5. Construct an SDK `AgentDefinition` object.

**Frontmatter field mapping:**

| Agent file frontmatter | Target                            | Transform                                                                                                                                    |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`          | `AgentDefinition.description`     | Direct string copy                                                                                                                           |
| `tools`                | `AgentDefinition.tools`           | Split comma-separated string, trim whitespace -> `string[]`. If already an array (YAML list syntax), use directly.                           |
| `disallowedTools`      | `AgentDefinition.disallowedTools` | Same comma-separated -> `string[]` transform as `tools`. Tools in this list are denied even if they appear in `tools` or would be inherited. |
| `model`                | `AgentDefinition.model`           | Direct string copy (e.g., `'opus'`). Defaults to `'inherit'` if absent.                                                                      |
| `maxTurns`             | `query()` option                  | Parsed as integer. Session-level option, not part of `AgentDefinition`. If absent, the SDK default applies.                                  |
| (markdown body)        | `AgentDefinition.prompt`          | Direct string copy. Project context is appended (see [Project Context Injection](#project-context-injection)).                               |

**Fields not mapped to `AgentDefinition`:** `hooks` and `permissionMode` from the agent file
frontmatter are overridden by the adapter's programmatic configuration.

**Error handling:** If the agent definition file cannot be read (missing, permissions error) or
contains malformed YAML, the `startAgent` promise rejects.

### Structured Output

The adapter uses the SDK's `outputFormat` option to get validated structured output from agent
sessions. Per-role Zod schemas define the expected output shape. The SDK enforces the schema — the
agent's final response is guaranteed to match or the session fails.

#### Agent Output Schemas

Each role has a Zod schema defining what the agent outputs. These are distinct from the full
`AgentResult` types — the Implementor's `patch` field is adapter-extracted (see
[Patch Extraction](#patch-extraction)), not agent-produced.

```ts
// --- Planner ---

const PlannedWorkItemSchema = z.object({
  tempID: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  blockedBy: z.array(z.string()), // tempIDs (from this result) or existing WorkItem ids
});

const PlannedWorkItemUpdateSchema = z.object({
  workItemID: z.string(),
  body: z.string().nullable(), // null = no change
  labels: z.array(z.string()).nullable(),
});

const PlannerOutputSchema = z.object({
  role: z.literal("planner"),
  create: z.array(PlannedWorkItemSchema),
  close: z.array(z.string()),
  update: z.array(PlannedWorkItemUpdateSchema),
});

// --- Implementor (no patch field — adapter extracts it) ---

const ImplementorOutputSchema = z.object({
  role: z.literal("implementor"),
  outcome: z.enum(["completed", "blocked", "validation-failure"]),
  summary: z.string(),
});

// --- Reviewer ---

const AgentReviewCommentSchema = z.object({
  path: z.string(),
  line: z.number().nullable(),
  body: z.string(),
});

const AgentReviewSchema = z.object({
  verdict: z.enum(["approve", "needs-changes"]),
  summary: z.string(),
  comments: z.array(AgentReviewCommentSchema),
});

const ReviewerOutputSchema = z.object({
  role: z.literal("reviewer"),
  review: AgentReviewSchema,
});
```

The Zod schemas are converted to JSON Schema via `z.toJSONSchema()` and passed to the SDK's
`outputFormat` option. The sub-schemas mirror the domain types defined in
[domain-model.md: Agent Results](./domain-model.md#agent-results).

#### Result Assembly

When the SDK session completes, the adapter reads `message.structured_output` from the result
message and validates it with `safeParse`:

1. Extract `message.structured_output` from the result message (where `message.type === 'result'`).
2. Validate with `<RoleSchema>.safeParse(message.structured_output)`.
3. If validation fails, reject `handle.result` with the Zod error.
4. For Planner and Reviewer: the validated output IS the `AgentResult` — resolve `handle.result`.
5. For Implementor: enrich the validated output with the extracted `patch` field (see
   [Patch Extraction](#patch-extraction)) to produce the full `ImplementorResult`, then resolve.

**SDK-level failure:** If the agent cannot produce valid output after the SDK's internal retries,
the result message has `subtype: 'error_max_structured_output_retries'`. The adapter treats this as
agent failure — `handle.result` rejects.

> **Rationale:** SDK-native `outputFormat` replaces manual JSON code block parsing. The SDK handles
> schema enforcement and retry logic, eliminating a class of extraction bugs. Zod provides both the
> JSON Schema (for the SDK) and the runtime validator (for `safeParse`) from a single source of
> truth.

### SDK Session Configuration

The adapter creates agent sessions using `query()` from `@anthropic-ai/claude-agent-sdk`.

**Call signature:**

```ts
import { z } from "zod";
import { query } from "@anthropic-ai/claude-agent-sdk";

const outputSchema = getOutputSchemaForRole(role); // per-role Zod schema

const q = query({
  prompt: enrichedPrompt,
  options: {
    agent: role,
    agents: {
      [role]: agentDefinition,
    },
    ...(maxTurns !== undefined && { maxTurns }),
    cwd: workingDirectory,
    outputFormat: {
      type: "json_schema",
      schema: z.toJSONSchema(outputSchema),
    },
    settingSources: [],
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [config.bashValidatorHook] }],
    },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    abortController,
  },
});
```

**Option details:**

| Option                            | Value                                                               | Purpose                                                                                            |
| --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `prompt`                          | Enriched trigger prompt                                             | Built by context assembly.                                                                         |
| `agent`                           | Role name                                                           | Selects which agent definition to use from the `agents` map.                                       |
| `agents`                          | `Record<string, AgentDefinition>`                                   | Inline agent definition. `prompt` field includes appended project context.                         |
| `maxTurns`                        | Integer from frontmatter                                            | From agent definition frontmatter. Omitted if absent (SDK default applies).                        |
| `cwd`                             | Worktree or repo root                                               | Implementor: `.worktrees/<branchName>`. Planner, Reviewer: repository root.                        |
| `outputFormat`                    | `{ type: 'json_schema', schema }`                                   | Per-role Zod schema converted via `z.toJSONSchema()`. See [Structured Output](#structured-output). |
| `settingSources`                  | `[]` (empty)                                                        | Intentionally empty. See [Known Limitations](#known-limitations).                                  |
| `hooks`                           | `{ PreToolUse: [{ matcher: 'Bash', hooks: [bashValidatorHook] }] }` | Programmatic hooks. See [Programmatic Hooks](#programmatic-hooks).                                 |
| `permissionMode`                  | `'bypassPermissions'`                                               | Agents run non-interactively. All tool invocations are auto-approved.                              |
| `allowDangerouslySkipPermissions` | `true`                                                              | Required safety acknowledgment (SDK >= 0.2.x).                                                     |
| `abortController`                 | `AbortController`                                                   | Cancellation handle for user cancellation, shutdown, and duration timeout.                         |

### Project Context Injection

Because `settingSources` is empty, the adapter manually loads project context files and appends them
to each agent's system prompt. At session creation, the adapter reads each file in
`config.contextPaths` (paths relative to `config.repoRoot`, UTF-8 encoding), concatenates their
contents (separated by double newlines), and appends the result to the agent definition's `prompt`
field. The separator between the agent's original prompt and the appended context is a double
newline.

When `contextPaths` is empty, the agent's original prompt is used as-is. Files are read fresh on
every session creation — no caching.

**Default context paths:** The caller passes `['.claude/CLAUDE.md']` as the default `contextPaths`
via `ClaudeAdapterConfig`.

> **Rationale:** This ensures all agents receive the project's coding conventions — equivalent to
> what `settingSources: ['project']` would have provided for CLAUDE.md.

**Error handling:** If a context file cannot be read, the `startAgent` promise rejects.

### Programmatic Hooks

The adapter passes hooks to the SDK programmatically via the `hooks` option in `query()`. The
`config.bashValidatorHook` is a `PreToolUse` hook callback (matcher: `Bash`) that validates every
Bash command against a blocklist/allowlist filter before execution.

The hook callback signature follows the narrowed `BashValidatorHook` type defined in
`ClaudeAdapterConfig` — the adapter maps this to the SDK's internal hook type at the module
boundary. Validation rules (blocklist patterns, allowlist prefixes, command segmentation, evaluation
order) are defined in [agent-hook-bash-validator.md](./agent-hook-bash-validator.md).

### Output Stream

The `AgentRunHandle.output` is an `AsyncIterable<string>` of plain text chunks extracted from the
SDK session's message stream. The adapter subscribes to the session internally, extracts text
content from assistant messages, and re-yields it as plain strings.

Binary data, tool use metadata, and system messages are not surfaced — only human-readable text
output. The stream ends when the agent session completes (success, failure, or cancellation).
Cancelling a session causes the iterable to complete.

### Duration Timeout

The adapter starts a timer for `config.maxAgentDuration` seconds when a session begins. If the timer
fires before the session completes, the adapter cancels the session via the `AbortController`. This
is treated as agent failure — `handle.result` rejects.

### Agent Session Logging

When `config.logging.agentSessions` is enabled, the adapter writes a human-readable transcript of
each agent session to disk. See
[control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md) for
file lifecycle, format, message formatting, error handling, and log file path computation.

### Module Location

The Claude adapter lives in `engine/runtime-adapter/`. Directory structure:

```
engine/runtime-adapter/
  types.ts                          <- core types (owned by runtime-adapter.md)
  schemas.ts                        <- Zod schemas (Claude-specific)
  create-claude-adapter.ts          <- factory
  extract-patch.ts                  <- git diff extraction
  load-agent-definition.ts          <- .claude/agents/*.md loading
  context-assembly/
    build-planner-context.ts
    build-implementor-context.ts
    build-reviewer-context.ts
```

## Acceptance Criteria

### startAgent Lifecycle

- [ ] Given `startAgent` is called with `ImplementorStartParams`, when worktree setup fails
      (`yarn install` error), then the promise rejects, the worktree is removed, and no agent
      session is created.
- [ ] Given an Implementor session completes (success or failure), when cleanup runs, then both the
      worktree and the local branch are removed.
- [ ] Given a stale worktree exists at the target path from a previous interrupted run, when an
      Implementor session starts, then the stale worktree is removed before creating the new one.
- [ ] Given a local branch already exists at `<branchName>`, when the worktree is created with `-B`,
      then the branch is force-reset to `defaultBranch` and the worktree starts clean.
- [ ] Given a Reviewer session starts, when `cwd` is configured, then it is the repository root (no
      worktree).
- [ ] Given `startAgent` is called for any role, when the agent definition file is missing, then the
      promise rejects.
- [ ] Given `startAgent` is called for any role, when the agent definition file contains malformed
      YAML, then the promise rejects.
- [ ] Given `startAgent` is called for any role, when a context assembly fetch fails (spec read,
      work item body, revision files), then the promise rejects and any created worktree is cleaned
      up.
- [ ] Given `contextPaths` contains one or more readable files, when a session is created, then the
      file contents are appended to the agent definition's prompt field separated by double
      newlines.
- [ ] Given `contextPaths` is empty in the adapter config, when a session is created, then the
      agent's original prompt is used as-is with no context appended.
- [ ] Given a context file in `contextPaths` cannot be read, when `startAgent` attempts to load it,
      then the promise rejects.

### cancelAgent

- [ ] Given a running agent session, when `cancelAgent` is called with its session ID, then the
      session terminates and `handle.result` rejects.
- [ ] Given a running Implementor session, when `cancelAgent` is called, then the worktree and local
      branch are cleaned up after the session terminates.
- [ ] Given `cancelAgent` is called with an unknown session ID, when the call executes, then it is a
      no-op.

### Context Assembly — Planner

- [ ] Given `startAgent` is called with `PlannerStartParams` containing two spec paths, when context
      is assembled, then the enriched prompt includes full content for both specs.
- [ ] Given a spec path has no entry in `lastPlannedSHAs`, when context is assembled, then the spec
      is classified as `added` with no diff section.
- [ ] Given a spec path has an entry in `lastPlannedSHAs` with a different blobSHA, when context is
      assembled, then the spec is classified as `modified` with a unified diff section.
- [ ] Given existing work items in the state store, when planner context is assembled, then the
      prompt includes a work item listing with id, title, status, and body for each.

### Context Assembly — Implementor

- [ ] Given an Implementor session for a work item with no linked revision, when context is
      assembled, then the prompt contains only the work item section (no revision, reviews, or CI
      sections).
- [ ] Given an Implementor session for a work item with a linked revision, when context is
      assembled, then the prompt includes revision files fetched via the revision reader.
- [ ] Given an Implementor session for a work item whose linked revision has `pipeline.status` of
      `failure`, when context is assembled, then the prompt includes a CI status section.
- [ ] Given an Implementor session for a work item whose linked revision has `pipeline.status` of
      `success`, when context is assembled, then no CI status section is included.
- [ ] Given an Implementor session for a work item with a linked revision but no prior reviews, when
      `getReviewHistory` returns empty arrays, then the "Prior Reviews" and "Prior Inline Comments"
      sections are omitted.

### Context Assembly — Reviewer

- [ ] Given a Reviewer session, when context is assembled, then the prompt includes work item body,
      revision files, and review history.
- [ ] Given a Reviewer session for a first-time review (no prior reviews), when `getReviewHistory`
      returns empty arrays, then the "Prior Reviews" and "Prior Inline Comments" sections are
      omitted.
- [ ] Given a revision file with `patch: null`, when the enriched prompt is built, then the file
      entry includes the path and status but no code block.

### Patch Extraction

- [ ] Given an Implementor session completes with outcome `completed`, when the adapter extracts the
      patch, then `handle.result` resolves with an `ImplementorResult` whose `patch` is a non-empty
      unified diff string.
- [ ] Given an Implementor session completes with outcome `completed` but the worktree has no
      changes vs main, when the adapter runs `git diff`, then `handle.result` rejects (empty patch
      treated as failure).
- [ ] Given an Implementor session completes with outcome `blocked`, when result assembly runs, then
      `patch` is `null` and no diff extraction is attempted.
- [ ] Given an Implementor session completes with outcome `validation-failure`, when result assembly
      runs, then `patch` is `null` and no diff extraction is attempted.

### Structured Output

- [ ] Given an agent session completes with valid structured output matching the role's Zod schema,
      when `safeParse` validates it, then `handle.result` resolves with the correctly typed result.
- [ ] Given an agent session fails to produce valid output after SDK retries (subtype
      `error_max_structured_output_retries`), when the result message is received, then
      `handle.result` rejects.
- [ ] Given an Implementor session completes with valid structured output, when result assembly
      runs, then the adapter enriches the agent output with the extracted patch to produce the full
      `ImplementorResult`.

### Agent Definition Loading

- [ ] Given an agent definition file includes a `maxTurns` frontmatter field, when `query()` is
      called, then the `maxTurns` session option is set to the parsed integer value.
- [ ] Given an agent definition file does not include `maxTurns`, when `query()` is called, then
      `maxTurns` is omitted (SDK default applies).
- [ ] Given an agent definition file has `tools` as a comma-separated string, when parsed, then
      `AgentDefinition.tools` is a trimmed `string[]`.
- [ ] Given an agent definition file has `disallowedTools`, when parsed, then
      `AgentDefinition.disallowedTools` is set and those tools are denied even if listed in `tools`.
- [ ] Given an agent definition file does not include `model`, when the agent definition is built,
      then `model` defaults to `'inherit'`.

### Output Stream

- [ ] Given a running agent session producing SDK `tool_use` and `system` messages, when the output
      iterable is consumed, then those messages are not surfaced (only text content is yielded).
- [ ] Given an agent session completes normally, when the output iterable is consumed, then the
      iterable completes (no hanging iterators).
- [ ] Given an agent session is cancelled, when the output iterable is being consumed, then the
      iterable completes promptly after cancellation.

### Duration Timeout

- [ ] Given `maxAgentDuration` is 300 seconds, when an agent session runs longer than 300 seconds,
      then the session is cancelled and `handle.result` rejects.

### SDK Isolation

- [ ] Given the engine codebase, when inspected, then no file outside `engine/runtime-adapter/`
      imports from `@anthropic-ai/claude-agent-sdk` or `gray-matter`.

## Known Limitations

- **`settingSources` SDK workaround.** The SDK's `settingSources: ['project']` resolution hangs when
  `cwd` is a git worktree (`.git` file vs directory issue). The adapter sets `settingSources: []`
  and handles all project-level concerns manually: agent definitions via inline loading, project
  context (CLAUDE.md) via `contextPaths`, hooks via the programmatic `hooks` option, and
  `permissionMode` via the explicit option. This applies to all agent types for consistency, even
  though the Planner does not run in a worktree.

## Dependencies

- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) — Core
  contract: `RuntimeAdapter` interface, `AgentRunHandle`, `AgentStartParams`, `RuntimeAdapterDeps`,
  `RuntimeAdapterConfig`, `ReviewHistory` types, lifecycle contracts, context data requirements.
- [domain-model.md](./domain-model.md) — `AgentResult` types (`PlannerResult`, `ImplementorResult`,
  `ReviewerResult`, `AgentReview`), mutation boundary contract.
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) —
  `startAgentAsync` lifecycle (consumer of `RuntimeAdapter`).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `lastPlannedSHAs`.
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `WorkProviderReader`, `RevisionProviderReader` interfaces.
- [control-plane-engine-agent-session-logging.md](./control-plane-engine-agent-session-logging.md) —
  Agent session transcript logging.
- [agent-hook-bash-validator.md](./agent-hook-bash-validator.md) — Normative validation rules for
  the Bash tool hook.
- `@anthropic-ai/claude-agent-sdk` (>= 0.2.x) — `query()` API for agent invocations, `outputFormat`
  for structured output.
- `zod` — Schema definitions for agent structured output. Generates JSON Schema for the SDK's
  `outputFormat` option and provides runtime validation via `safeParse`.
- `gray-matter` — YAML frontmatter parser for agent definition files.

## References

- [domain-model.md: Agent Results](./domain-model.md#agent-results) — Structured output types
  (`PlannerResult`, `ImplementorResult`, `ReviewerResult`, `AgentReview`).
- [control-plane-engine-command-executor.md: startAgentAsync](./control-plane-engine-command-executor.md#startagentasync)
  — Async lifecycle manager that consumes `AgentRunHandle`.
- [agent-hook-bash-validator-script.md](./agent-hook-bash-validator-script.md) — Shell script
  implementation of the bash validator (for interactive use outside the control plane).
