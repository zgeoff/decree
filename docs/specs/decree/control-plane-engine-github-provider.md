---
title: Control Plane Engine — GitHub Provider
version: 0.2.0
last_updated: 2026-02-16
status: approved
---

# Control Plane Engine — GitHub Provider

## Overview

The GitHub provider maps the five provider interfaces (three readers, two writers) to the GitHub
REST API. It normalizes GitHub-specific types (issues, pull requests, tree entries, labels, check
suites) into domain types (`WorkItem`, `Revision`, `Spec`) at the boundary. No GitHub-specific types
leak past the provider — all consumers operate on domain types only.

## Constraints

- All methods return or accept domain types — no Octokit response shapes or GitHub-specific fields
  in the public interface.
- Octokit is isolated within the provider module. No file outside `engine/github-provider/` may
  import from `@octokit/*`.
- Reader methods are read-only — they never create, update, or delete GitHub resources.
- Writer methods perform external mutations — they are consumed only by the CommandExecutor.
- Provider-internal retry handles transient failures. Callers never see transient errors — provider
  calls either succeed or fail permanently after retries are exhausted.

## Specification

### Provider Interfaces

Five interfaces define the provider contract. They are provider-agnostic — they reference only
domain types defined in [002-architecture.md: Domain Model](./v2/002-architecture.md#domain-model).

#### WorkProviderReader

```ts
interface WorkProviderReader {
  listWorkItems(): Promise<WorkItem[]>;
  getWorkItem(id: string): Promise<WorkItem | null>;
  getWorkItemBody(id: string): Promise<string>;
}
```

- `listWorkItems` — returns all open work items matching the issue filter.
- `getWorkItem` — returns a single work item by id, regardless of state or labels (no filtering).
  Returns `null` if not found.
- `getWorkItemBody` — returns the body content of a work item (on-demand detail fetch). Strips
  provider-internal metadata (see [Dependency Metadata](#dependency-metadata)).

#### WorkProviderWriter

```ts
interface WorkProviderWriter {
  transitionStatus(workItemID: string, newStatus: WorkItemStatus): Promise<void>;
  createWorkItem(
    title: string,
    body: string,
    labels: string[],
    blockedBy: string[],
  ): Promise<WorkItem>;
  updateWorkItem(workItemID: string, body: string | null, labels: string[] | null): Promise<void>;
}
```

- `transitionStatus` — transitions a work item to a new status.
- `createWorkItem` — creates a new work item. Returns the created entity.
- `updateWorkItem` — updates body and/or labels on an existing work item. `null` parameters mean no
  change for that field.

#### RevisionProviderReader

```ts
interface RevisionProviderReader {
  listRevisions(): Promise<Revision[]>;
  getRevision(id: string): Promise<Revision | null>;
  getRevisionFiles(id: string): Promise<RevisionFile[]>;
}
```

- `listRevisions` — returns all open revisions (including drafts) with pipeline status and linkage
  populated.
- `getRevision` — returns a single revision by id. Returns `null` if not found.
- `getRevisionFiles` — returns the changed files for a revision (on-demand detail fetch).

#### RevisionProviderWriter

```ts
interface RevisionProviderWriter {
  createFromPatch(workItemID: string, patch: string, branchName: string): Promise<Revision>;
  updateBody(revisionID: string, body: string): Promise<void>;
  postReview(revisionID: string, review: AgentReview): Promise<string>;
  updateReview(revisionID: string, reviewID: string, review: AgentReview): Promise<void>;
  postComment(revisionID: string, body: string): Promise<void>;
}
```

- `createFromPatch` — applies a patch, creates or updates a branch, and opens or updates a PR.
  Returns the revision. See [createFromPatch Behavior](#createfrompatch-behavior).
- `updateBody` — updates the body of an existing revision.
- `postReview` — creates a review on a revision. Returns the review ID.
- `updateReview` — replaces an existing review (dismiss and recreate).
- `postComment` — posts a comment on a revision.

#### SpecProviderReader

```ts
interface SpecProviderReader {
  listSpecs(): Promise<Spec[]>;
}
```

- `listSpecs` — returns all files (recursively) in the configured specs directory on the default
  branch. Every file in the tree is treated as a spec — no file extension filtering is applied.

### RevisionFile

```ts
interface RevisionFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  patch: string | null;
}
```

`patch` is `null` for binary files or files exceeding GitHub's diff size limit. The file is still
included — consumers see the path and status, but no diff content.

### createGitHubProvider

```ts
function createGitHubProvider(config: GitHubProviderConfig): GitHubProvider;

interface GitHubProviderConfig {
  appID: number;
  privateKey: string; // PEM file content (caller reads from disk)
  installationID: number;
  owner: string;
  repo: string;
  specsDir: string; // path relative to repo root (e.g., 'docs/specs/')
  defaultBranch: string; // branch to monitor (e.g., 'main')
}

interface GitHubProvider {
  workItemReader: WorkProviderReader;
  workItemWriter: WorkProviderWriter;
  revisionReader: RevisionProviderReader;
  revisionWriter: RevisionProviderWriter;
  specReader: SpecProviderReader;
}
```

The factory creates a single Octokit instance (with `@octokit/auth-app` as the authentication
strategy) and constructs all five interface objects sharing it.

At creation time, the factory resolves the authenticated app's bot username (`{appSlug}[bot]`) via
the GitHub App API (`GET /app`). This username is used to identify engine-posted reviews when
populating `Revision.reviewID`.

> **Rationale:** A single Octokit instance ensures consistent authentication and rate limit
> budgeting across all provider operations.

### Domain Type Mapping

#### Issue → WorkItem

| WorkItem field   | GitHub source                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `id`             | `String(issue.number)`                                                                          |
| `title`          | `issue.title`                                                                                   |
| `status`         | Parsed from `status:*` labels (see [Label Parsing](#label-parsing))                             |
| `priority`       | Parsed from `priority:*` labels                                                                 |
| `complexity`     | Parsed from `complexity:*` labels                                                               |
| `blockedBy`      | Parsed from dependency metadata in issue body (see [Dependency Metadata](#dependency-metadata)) |
| `createdAt`      | `issue.created_at` (ISO 8601)                                                                   |
| `linkedRevision` | Cross-referenced from open PRs via closing-keyword matching                                     |

**Issue filtering:** Only open issues with the `task:implement` label are returned by
`listWorkItems`. Closed issues, issues with `task:refinement`, and issues with no task label are
excluded.

**`linkedRevision` resolution:** For each work item, the provider scans the current set of open PRs
for closing-keyword matches (see [Closing-Keyword Matching](#closing-keyword-matching)). If a match
is found, `linkedRevision` is the revision id (PR number as string). If no match, `linkedRevision`
is `null`.

> **Rationale:** Cross-referencing at the provider boundary keeps the engine free of GitHub-specific
> correlation logic.

#### Pull Request → Revision

| Revision field | GitHub source                                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `id`           | `String(pr.number)`                                                                       |
| `title`        | `pr.title`                                                                                |
| `url`          | `pr.html_url`                                                                             |
| `headSHA`      | `pr.head.sha`                                                                             |
| `headRef`      | `pr.head.ref`                                                                             |
| `author`       | `pr.user?.login ?? ''`                                                                    |
| `body`         | `pr.body ?? ''`                                                                           |
| `isDraft`      | `pr.draft ?? false`                                                                       |
| `workItemID`   | From closing-keyword matching in PR body                                                  |
| `pipeline`     | Derived from check suites (see [Pipeline Status Derivation](#pipeline-status-derivation)) |
| `reviewID`     | ID of the review authored by the app's bot, if any                                        |

**`workItemID` resolution:** The provider parses the PR body for closing keywords referencing an
issue number (see [Closing-Keyword Matching](#closing-keyword-matching)). If multiple closing
keywords are present, the first match by position in the body is used. `workItemID` is the matched
issue number as a string. If no match is found, `workItemID` is `null`.

**`reviewID` resolution:** The provider fetches reviews for each PR and checks for reviews authored
by the app's bot username. If found, `reviewID` is `String(review.id)`. If no bot-authored review
exists, `reviewID` is `null`. If multiple bot-authored reviews exist, the most recent one is used.

**`pipeline` caching:** The GitHub provider may cache the last-seen head SHA and pipeline status per
revision internally to skip redundant CI fetches when the SHA is unchanged and the pipeline status
is `success`.

> **Rationale:** The skip optimization reduces API calls from 2×N per cycle to 2×M where M is
> revisions with pending/failed CI or new commits — the same optimization used by the v1 PR Poller.

#### Tree Entry → Spec

| Spec field          | GitHub source                                            |
| ------------------- | -------------------------------------------------------- |
| `filePath`          | Repo-relative path (specsDir prefix + tree entry path)   |
| `blobSHA`           | Tree entry `sha`                                         |
| `frontmatterStatus` | Parsed from file content YAML frontmatter `status` field |

The `filePath` is the full repo-relative path (e.g., `docs/specs/decree/workflow.md`), constructed
by joining the configured `specsDir` with the tree entry's relative path.

Files without parseable YAML frontmatter are included with `frontmatterStatus: 'draft'`.

**Tree SHA optimization:** The provider may cache the tree SHA of the specs directory internally. If
the tree SHA is unchanged from the last call, `listSpecs` returns the previous result without
re-fetching individual file content.

> **Rationale:** The tree SHA comparison makes the common case (nothing changed) a single API call —
> the same optimization used by the v1 SpecPoller.

### Label Parsing

Labels with recognized prefixes are parsed into domain enums. Unrecognized values within a
recognized prefix are discarded before selection — only recognized values participate in the
alphabetical tie-breaking rule. If no recognized value remains, the field gets its default value.

GitHub's label API returns labels as `(string | { name?: string })[]`. The provider extracts label
names: bare strings are used directly, objects yield their `name` property, objects without a `name`
property are discarded.

#### Status Labels

| GitHub Label              | WorkItemStatus     |
| ------------------------- | ------------------ |
| `status:pending`          | `pending`          |
| `status:ready`            | `ready`            |
| `status:in-progress`      | `in-progress`      |
| `status:review`           | `review`           |
| `status:approved`         | `approved`         |
| `status:closed`           | `closed`           |
| `status:needs-refinement` | `needs-refinement` |
| `status:blocked`          | `blocked`          |

Default (no `status:*` label): `pending`.

If multiple `status:*` labels are present, the first match alphabetically is used.

#### Priority Labels

| GitHub Label      | Priority |
| ----------------- | -------- |
| `priority:high`   | `high`   |
| `priority:medium` | `medium` |
| `priority:low`    | `low`    |

Default (no `priority:*` label): `null`.

#### Complexity Labels

| GitHub Label         | Complexity |
| -------------------- | ---------- |
| `complexity:trivial` | `trivial`  |
| `complexity:low`     | `low`      |
| `complexity:medium`  | `medium`   |
| `complexity:high`    | `high`     |

Default (no `complexity:*` label): `null`.

### Closing-Keyword Matching

PR→WorkItem linkage is determined by searching the PR body for a closing keyword referencing an
issue number.

**Supported keywords** (case-insensitive): `Closes`, `Close`, `Closed`, `Fixes`, `Fix`, `Fixed`,
`Resolves`, `Resolve`, `Resolved`.

**Pattern:** `<keyword> #<number>` where `<number>` is followed by whitespace, punctuation, or end
of line — not additional digits (word-boundary match).

If multiple open PRs match the same issue, the first match by PR number (ascending) is used.

The closing-keyword logic is shared between `listWorkItems` (for `linkedRevision`) and
`listRevisions` (for `workItemID`).

### Pipeline Status Derivation

CI status for a revision is derived from two GitHub API endpoints using the PR's `head.sha`:

1. `repos.getCombinedStatusForRef(ref)` — commit statuses.
2. `checks.listForRef(ref)` — check runs.

**Derivation rules:**

| Condition                                                                                                                                                                         | PipelineStatus |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `getCombinedStatusForRef` reports `state: 'failure'`, or any check run has `conclusion` of `failure`, `cancelled`, or `timed_out`                                                 | `failure`      |
| Any check run has `status` other than `completed` (`queued` or `in_progress`), or `getCombinedStatusForRef` reports `state: 'pending'`, or both endpoints report `total_count: 0` | `pending`      |
| `getCombinedStatusForRef` reports `state: 'success'` and all check runs have `status: 'completed'` with `conclusion: 'success'`                                                   | `success`      |

**PipelineResult construction:**

- `url` and `reason` are populated only when `status` is `failure`. `url` is the `detailsURL` of the
  first failing check run (by API order). `reason` is its name.
- When `status` is `success` or `pending`, `url` and `reason` are `null`.
- `pipeline` is `null` only when the CI status fetch fails for a revision after retries are
  exhausted. This is an exception to the general "fail permanently" constraint: `listRevisions`
  degrades gracefully by returning the revision with `pipeline: null` rather than failing the entire
  call, because CI status is ancillary to the revision's core data.

### Dependency Metadata

Work item dependencies (`blockedBy`) are persisted as a machine-readable HTML comment appended to
the issue body.

**Format:**

```html
<!-- decree:blockedBy #42 #43 -->
```

Issue references are space-separated, prefixed with `#`. When `blockedBy` is empty, no metadata
comment is added.

**Write behavior** (`createWorkItem`): The writer appends the metadata comment to the body after a
blank line. If `blockedBy` is empty, no comment is appended.

**Read behavior** (`listWorkItems`, `getWorkItem`): The reader parses the metadata comment and
populates `WorkItem.blockedBy` with the extracted issue numbers as strings (without `#` prefix). If
no metadata comment is present, `blockedBy` is `[]`.

**Update behavior** (`updateWorkItem`): When `body` is non-null, the provider replaces only the
content portion of the issue body while preserving the existing dependency metadata comment. Steps:
(1) fetch the current body, (2) extract the existing metadata comment (if any), (3) write the new
body with the existing metadata re-appended. When `body` is `null`, the body (including metadata) is
left unchanged.

**Body access** (`getWorkItemBody`): Strips the metadata comment before returning the body. The
caller receives clean content without provider-internal metadata.

### Null Coercion

At the provider boundary, nullable GitHub API fields are coerced to non-nullable domain types:

| GitHub field | Coercion                           |
| ------------ | ---------------------------------- |
| `body`       | `string \| null` → `string` (`''`) |
| `user.login` | optional → `string` (`''`)         |
| `draft`      | optional → `boolean` (`false`)     |

### Writer Behavior

#### transitionStatus

1. Fetch the issue's current labels.
2. Remove any existing `status:*` label.
3. Add the new `status:<newStatus>` label.
4. If `newStatus` is `closed`, also close the issue via `issues.update({ state: 'closed' })`.

#### createWorkItem

1. Create a GitHub issue with:
   - `title`: provided title.
   - `body`: provided body + dependency metadata comment (if `blockedBy` is non-empty).
   - `labels`: `['task:implement']` + provided labels.
2. Return the created issue as a `WorkItem` (same mapping as reader).

#### updateWorkItem

1. If `body` is non-null: a. Fetch the issue's current body. b. Extract the existing dependency
   metadata comment (if any). c. Update the issue body to: new body + existing metadata comment
   (re-appended after a blank line).
2. If `labels` is non-null: a. Replace all non-reserved labels on the issue with the provided
   labels. b. Reserved labels (`task:*`, `status:*`) are preserved — the provider does not remove or
   overwrite them via `updateWorkItem`.

> **Rationale:** Preserving dependency metadata across body updates prevents silent data loss.
> Preserving reserved labels prevents `updateWorkItem` from interfering with status transitions and
> task classification managed by other writer methods.

#### createFromPatch Behavior

`createFromPatch(workItemID, patch, branchName)` applies the given patch, creates or updates the
specified branch, and opens or updates a PR linking to the work item.

The `patch` parameter is a unified diff (the format produced by `git diff`). The provider applies it
entirely via the GitHub Git Data API — no local git binary or filesystem is used.

1. Fetch the default branch HEAD commit SHA and its tree.
2. Parse the unified diff to determine file additions, modifications, and deletions.
3. Create blobs for added/modified file contents, build a new tree reflecting the changes against
   the default branch tree.
4. Determine the commit parent:
   - **Branch does not exist:** Parent is the default branch HEAD commit.
   - **Branch already exists:** Parent is the current branch tip commit.
5. Create a commit on the new tree with the determined parent. Commit message:
   `decree: apply patch for #<workItemID>`.
6. Create or update the branch ref `refs/heads/<branchName>` to the new commit SHA.
7. Check if an open PR already exists for the branch name (`head.ref === branchName`). If no
   branch-name match, fall back to closing-keyword match for the work item.
8. **No existing PR:** Fetch the work item to obtain its title. Create a new PR with
   `head: branchName`, `base: defaultBranch`, the work item's title, and `Closes #<workItemID>` in
   the body.
9. **Existing PR (branch-name match):** The branch update causes the PR to update automatically. No
   additional PR mutation is needed.
10. **Existing PR (closing-keyword match only, different branch):** This is an abnormal state — a PR
    links to the work item but on a different branch. The provider ignores it and proceeds as "no
    existing PR" (step 8), creating a new PR on `branchName`. The old PR remains open for manual
    cleanup.
11. Return the created or updated PR as a `Revision`.

> **Rationale:** The tree is always computed against the default branch HEAD, so the resulting file
> state is correct regardless of prior branch history. Using the branch tip as the parent (when the
> branch exists) preserves commit history — each `createFromPatch` call adds a new commit, and the
> diff between successive commits shows exactly what changed between review rounds. This enables
> GitHub's "Changes since last review" feature for iterative PR review.

**Idempotency:** If a revision already exists for the work item (detected via existing branch or
linked revision), the provider updates the existing revision rather than creating a duplicate. This
covers re-dispatch after agent failure — the implementor runs again, produces a new patch, and
`createFromPatch` pushes to the same branch.

> **Rationale:** Idempotency at the provider boundary keeps the trust boundary clean — the
> CommandExecutor does not need to check for existing revisions before calling `createFromPatch`.

#### postReview

1. Map `review.verdict`: `approve` → GitHub event `APPROVE`, `needs-changes` → `REQUEST_CHANGES`.
2. Create the review with `body: review.summary` and inline comments from `review.comments`.
3. For each comment: `path` and `body` are passed directly. `line` is included when non-null;
   omitted when null (GitHub places it as a general file-level comment).
4. Return `String(review.id)`.

#### updateReview

1. Dismiss the existing review via `pulls.dismissReview`.
2. Create a new review with the updated content (same flow as `postReview`).

> **Rationale:** GitHub's `pulls.updateReview` only updates the body, not inline comments or the
> verdict. Dismiss-and-recreate provides a full replacement.

#### postComment

Posts a standalone comment (not a review) on the PR via `issues.createComment`.

### Retry Strategy

All provider methods retry transient failures internally. Callers never see transient errors — calls
either succeed or fail permanently after retries are exhausted.

| Parameter              | Value                             |
| ---------------------- | --------------------------------- |
| Retryable status codes | `429`, `500`, `502`, `503`, `504` |
| Max retries            | 3                                 |
| Base delay             | 1 second                          |
| Max delay              | 30 seconds                        |
| Strategy               | Exponential backoff with jitter   |

For `429` responses, the provider respects the `Retry-After` header if present (using it as the
delay instead of the computed backoff value).

Non-retryable errors (4xx other than 429) propagate immediately.

### Error Behavior for Detail Fetches

Detail-fetch methods (`getWorkItem`, `getWorkItemBody`, `getRevision`, `getRevisionFiles`) operate
on a single resource by ID. If the resource does not exist, the GitHub API returns a `404`.

- `getWorkItem` and `getRevision` return `null` on `404` (as declared in their return types).
- `getWorkItemBody` and `getRevisionFiles` throw on `404` — callers are expected to verify the
  resource exists before calling these methods. The `404` propagates as a non-retryable error per
  the [Retry Strategy](#retry-strategy).

For `listSpecs`, if any individual file content fetch fails after retries are exhausted, the entire
`listSpecs` call fails — there is no partial-success model.

### Configuration

The `GitHubProviderConfig` is defined in [createGitHubProvider](#creategithubprovider).

Authentication is handled by `@octokit/auth-app` — JWT creation, installation token exchange, and
automatic token refresh. The App must have: `issues:write` (work item operations),
`pull_requests:write` (revision operations), `contents:write` (branch creation, push), `checks:read`
(CI status).

### Module Location

> **v2 module.** This is new v2 code in `engine/github-provider/`, implemented alongside the v1
> `engine/github-client/` module. The v1 module continues to function on `main` until the engine
> replacement (migration plan Step 8). Do not modify or delete v1 modules when implementing this
> spec.

The provider lives in `engine/github-provider/`. Directory structure:

```
engine/github-provider/
  types.ts
  create-github-provider.ts
  mapping/
    map-issue-to-work-item.ts
    map-pr-to-revision.ts
    map-tree-entry-to-spec.ts
    parse-labels.ts
    parse-dependency-metadata.ts
    match-closing-keywords.ts
    derive-pipeline-status.ts
```

## Acceptance Criteria

### Interface Boundaries

- [ ] Given any reader method is called, when the result is returned, then it contains only domain
      types — no Octokit response shapes or GitHub-specific fields.
- [ ] Given any writer method is called, when the parameters are examined, then they accept only
      domain-level values — no GitHub issue numbers as integers or API-specific types.
- [ ] Given the provider module is inspected, when checking imports, then no file outside
      `engine/github-provider/` imports from `@octokit/*`.

### WorkItem Mapping

- [ ] Given an issue has no `status:*` label, when it is mapped to a WorkItem, then `status` is
      `pending`.
- [ ] Given an issue has multiple `status:*` labels, when it is mapped to a WorkItem, then the first
      match alphabetically is used.
- [ ] Given an issue has a `priority:medium` label, when it is mapped to a WorkItem, then `priority`
      is `medium`.
- [ ] Given an issue has no `priority:*` label, when it is mapped to a WorkItem, then `priority` is
      `null`.
- [ ] Given an issue has a `complexity:high` label, when it is mapped to a WorkItem, then
      `complexity` is `high`.
- [ ] Given an issue has no `complexity:*` label, when it is mapped to a WorkItem, then `complexity`
      is `null`.
- [ ] Given an issue has a `task:refinement` label instead of `task:implement`, when `listWorkItems`
      is called, then the issue is not included in the result.
- [ ] Given an issue body contains `<!-- decree:blockedBy #42 #43 -->`, when it is mapped to a
      WorkItem, then `blockedBy` is `['42', '43']`.
- [ ] Given an issue body contains no dependency metadata comment, when it is mapped to a WorkItem,
      then `blockedBy` is `[]`.
- [ ] Given an open PR references issue #5 via a closing keyword, when issue #5 is mapped to a
      WorkItem, then `linkedRevision` is the PR number as a string.

### Revision Mapping

- [ ] Given a PR body contains `Closes #10`, when it is mapped to a Revision, then `workItemID` is
      `'10'`.
- [ ] Given a PR body contains `fixes #10` (lowercase), when it is mapped to a Revision, then
      `workItemID` is `'10'`.
- [ ] Given a PR body contains no closing keyword, when it is mapped to a Revision, then
      `workItemID` is `null`.
- [ ] Given a PR body contains the text `Closes #1001` (where `1001` is not followed by additional
      digits), when closing-keyword matching is applied, then the match is `#1001` — the number
      `100` is not extracted as a partial match.
- [ ] Given a PR has a review authored by the app's bot username, when it is mapped to a Revision,
      then `reviewID` is the review's ID as a string.
- [ ] Given a PR has no bot-authored review, when it is mapped to a Revision, then `reviewID` is
      `null`.
- [ ] Given a PR with `body: null` from the GitHub API, when it is mapped to a Revision, then `body`
      is an empty string.
- [ ] Given a PR with no `user` object, when it is mapped to a Revision, then `author` is an empty
      string.

### Pipeline Status

- [ ] Given all check runs have `conclusion: 'success'` and combined status is `success`, when
      pipeline is derived, then `status` is `success`.
- [ ] Given any check run has `conclusion: 'failure'`, when pipeline is derived, then `status` is
      `failure`.
- [ ] Given a check run has `conclusion: 'cancelled'`, when pipeline is derived, then `status` is
      `failure`.
- [ ] Given a check run has `status: 'in_progress'`, when pipeline is derived, then `status` is
      `pending`.
- [ ] Given both CI endpoints report `total_count: 0`, when pipeline is derived, then `status` is
      `pending`.
- [ ] Given pipeline status is `failure`, when `PipelineResult` is constructed, then `url` and
      `reason` are populated from the first failing check run.
- [ ] Given pipeline status is `success`, when `PipelineResult` is constructed, then `url` and
      `reason` are `null`.
- [ ] Given the CI status fetch for a revision fails after retries are exhausted, when the revision
      is returned by `listRevisions`, then `pipeline` is `null` and the call does not fail.

### createFromPatch

- [ ] Given no PR exists for the work item, when `createFromPatch` is called, then a new branch is
      created and a PR is opened with a closing keyword in the body.
- [ ] Given a PR already exists for the work item (same branch), when `createFromPatch` is called,
      then the existing branch is updated and no duplicate PR is created.
- [ ] Given `createFromPatch` completes, when the result is returned, then it is a `Revision` with
      all fields populated.

### Writer Operations

- [ ] Given `transitionStatus` is called with `newStatus: 'in-progress'`, when the operation
      completes, then the old `status:*` label is removed and `status:in-progress` is added.
- [ ] Given `transitionStatus` is called with `newStatus: 'closed'`, when the operation completes,
      then the issue is closed and the `status:closed` label is added.
- [ ] Given `createWorkItem` is called with `blockedBy: ['42', '43']`, when the issue is created,
      then the body contains `<!-- decree:blockedBy #42 #43 -->` and the issue has the
      `task:implement` label.
- [ ] Given `createWorkItem` is called with `blockedBy: []`, when the issue is created, then the
      body does not contain a dependency metadata comment.
- [ ] Given `postReview` is called with `verdict: 'approve'`, when the review is created, then the
      GitHub review event is `APPROVE`.
- [ ] Given `postReview` is called with `verdict: 'needs-changes'`, when the review is created, then
      the GitHub review event is `REQUEST_CHANGES`.
- [ ] Given `updateReview` is called, when the operation completes, then the old review is dismissed
      and a new review is created.

### Detail Fetches

- [ ] Given `getWorkItem` is called with an ID that does not exist, when the API returns `404`, then
      `getWorkItem` returns `null`.
- [ ] Given `getRevision` is called with an ID that does not exist, when the API returns `404`, then
      `getRevision` returns `null`.
- [ ] Given `getRevisionFiles` is called for a valid revision, when the result is returned, then
      each file has `path`, `status`, and `patch` (or `patch: null` for binary files).
- [ ] Given `getWorkItemBody` is called for an ID that does not exist, when the API returns `404`,
      then the error propagates to the caller.

### updateWorkItem

- [ ] Given `updateWorkItem` is called with a non-null `body`, when the issue has an existing
      dependency metadata comment, then the new body replaces the content portion and the metadata
      comment is preserved.
- [ ] Given `updateWorkItem` is called with `body: null` and `labels: null`, when the operation
      completes, then the issue is unchanged.
- [ ] Given `updateWorkItem` is called with non-null `labels`, when the issue has `task:implement`
      and `status:in-progress` labels, then those reserved labels are preserved and the provided
      labels are applied alongside them.

### postComment and updateBody

- [ ] Given `postComment` is called, when the operation completes, then the comment appears as a
      standalone issue comment (not a review comment) on the PR.
- [ ] Given `updateBody` is called with a new body string, when the operation completes, then the
      PR's body is replaced with the provided string.

### Closing-Keyword Multi-Match

- [ ] Given a PR body contains `Closes #10` and `Fixes #20`, when it is mapped to a Revision, then
      `workItemID` is `'10'` (first match by position in the body).
- [ ] Given two open PRs (#3 and #7) both reference issue #5 via closing keywords, when issue #5 is
      mapped to a WorkItem, then `linkedRevision` is `'3'` (first match by PR number ascending).

### Bot Review Resolution

- [ ] Given a PR has two reviews authored by the app's bot username, when it is mapped to a
      Revision, then `reviewID` is the ID of the most recent bot-authored review.

### Retry

- [ ] Given a provider method receives a `429` response with a `Retry-After` header, when retrying,
      then it uses the `Retry-After` value as the delay.
- [ ] Given a provider method receives a `500` response, when retrying, then it retries up to 3
      times with exponential backoff.
- [ ] Given a provider method receives a `404` response, when the error occurs, then it propagates
      immediately without retry.
- [ ] Given a provider method exhausts all retries, when the final attempt fails, then the error
      propagates to the caller.

### Spec Mapping

- [ ] Given a spec file has frontmatter `status: approved`, when `listSpecs` is called, then the
      spec is included with `frontmatterStatus: 'approved'`.
- [ ] Given a file has no parseable YAML frontmatter, when `listSpecs` is called, then the spec is
      included with `frontmatterStatus: 'draft'`.
- [ ] Given the specs directory tree SHA is unchanged from the previous call, when `listSpecs` is
      called, then no individual file content is fetched.
- [ ] Given `listSpecs` returns a spec, when the `filePath` is examined, then it is the full
      repo-relative path (e.g., `docs/specs/decree/workflow.md`).
- [ ] Given `listSpecs` encounters a file content fetch that fails after retries are exhausted, when
      the error occurs, then the entire `listSpecs` call fails — no partial results are returned.

## Known Limitations

- **Pagination capped at 100 items per call.** All list endpoints (`issues.listForRepo`,
  `pulls.list`, `pulls.listFiles`, `pulls.listReviews`) use `per_page: 100` without pagination.
  Repositories exceeding this limit will have results silently truncated.
- **`linkedRevision` cross-reference requires PR data.** `listWorkItems` internally fetches the PR
  list to resolve `linkedRevision`. This adds API calls beyond what the issue list alone requires.
- **`updateReview` replaces rather than patches.** Due to GitHub API limitations, `updateReview`
  dismisses the old review and creates a new one. Old inline comments remain in PR history as
  dismissed.

## Dependencies

- [002-architecture.md](./v2/002-architecture.md) — Domain types (`WorkItem`, `Revision`, `Spec`,
  `PipelineResult`, `PipelineStatus`, `WorkItemStatus`, `Priority`, `Complexity`, `AgentReview`),
  provider interface definitions.
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState` for
  context on how providers feed the store.
- `@octokit/rest` — GitHub REST API client.
- `@octokit/auth-app` — GitHub App authentication strategy.

## References

- [002-architecture.md: Providers](./v2/002-architecture.md#providers) — Read/write interface
  definitions, read/write enforcement, GitHub implementation overview.
- [002-architecture.md: Domain Model](./v2/002-architecture.md#domain-model) — `WorkItem`,
  `Revision`, `Spec`, status enums.
- [002-architecture.md: Error Handling](./v2/002-architecture.md#error-handling) — Provider-internal
  retry strategy.
- [control-plane-engine.md: GitHub Client](./control-plane-engine.md#github-client) — Current
  `GitHubClient` interface being replaced by the provider abstraction.
- [control-plane-engine.md: Query Interface](./control-plane-engine.md#query-interface) — Current CI
  status derivation and closing-keyword matching logic.
