---
title: Control Plane TUI
version: 1.1.0
last_updated: 2026-02-18
status: approved
---

# Control Plane TUI

## Overview

The TUI is the user-facing module of the control plane. It renders a two-pane dashboard that
surfaces workflow state, provides on-demand agent dispatch, and streams live agent output. Built
with Ink (React for the terminal), the TUI is a thin projection of engine state — all domain data
comes from the engine's Zustand store via selectors. The TUI owns only UI-local concerns (selected
item, scroll position, panel focus, modal state).

## Constraints

- The TUI has no parallel data model. Domain state comes exclusively from the engine's state store
  via `useStore(engine.store, selector)`. No `Task` type, no event-derived copies.
- The TUI never writes to external systems. All mutations flow through `engine.enqueue(event)`.
- The TUI enqueues domain events, not commands. Commands are produced by handlers.
- The TUI never calls `store.setState()` on the engine store.
- The TUI is a consumer of the engine — the engine has no knowledge of the TUI. The dependency is
  strictly one-directional.
- Revisions with no linked work item (`workItemID: null`) are not surfaced.

## Specification

### Data Model

The TUI reads domain entities directly from the engine's state store. It does not define its own
entity types.

- **WorkItem** — from `EngineState.workItems`. Status, priority, complexity, linked revision, title,
  creation timestamp.
- **Revision** — from `EngineState.revisions`. Pipeline status, URL, head ref.
- **AgentRun** — from `EngineState.agentRuns`. Run status, role, session ID, branch name, log file
  path, error.

Domain types are defined in [domain-model.md: Domain Model](./domain-model.md#domain-model).
`AgentRun` variants are defined in
[control-plane-engine-state-store.md](./control-plane-engine-state-store.md#agentrun-variants).

Presentation-only derivations (display status, section assignment, sort weights) are computed inline
via TUI selectors.

### Display Status Derivation

`DisplayStatus` is a TUI-local concept — it determines how a work item is presented in the list,
which section it belongs to, and what the detail pane shows.

```ts
type DisplayStatus =
  | "approved"
  | "failed"
  | "blocked"
  | "needs-refinement"
  | "dispatch"
  | "pending"
  | "implementing"
  | "reviewing";
```

Derivation evaluates three inputs in priority order for a given work item. Let `latestRun` be the
most recent `AgentRun` for this work item (by `startedAt`, implementor and reviewer roles only).

**Step 1 — Active agent override:** If `latestRun` exists and has status `requested` or `running`:

- `latestRun.role === 'implementor'` → `implementing`
- `latestRun.role === 'reviewer'` → `reviewing`

**Step 2 — Failure override:** If `latestRun` exists and has status `failed` or `timed-out` →
`failed`.

**Step 3 — WorkItemStatus mapping:**

| `WorkItemStatus`   | `DisplayStatus`    |
| ------------------ | ------------------ |
| `pending`          | `pending`          |
| `ready`            | `dispatch`         |
| `in-progress`      | `implementing`     |
| `review`           | `reviewing`        |
| `approved`         | `approved`         |
| `needs-refinement` | `needs-refinement` |
| `blocked`          | `blocked`          |
| `closed`           | _(excluded)_       |

If `WorkItemStatus` is `closed` or not in the table, the work item is excluded from rendering.

> **Rationale:** Active agents take priority over failures because a new dispatch means the failure
> is being addressed. A failure with no active run means the work item needs attention — either
> awaiting policy-allowed re-dispatch or human intervention. The `cancelled` run status does not
> trigger the failure override — cancellation is user-initiated and not an error condition.

### State Subscription

The TUI subscribes to the engine's Zustand store via the React binding (`useStore` hook):

```ts
workItems = useStore(engine.store, (state) => state.workItems);
activePlannerRun = useStore(engine.store, getActivePlannerRun);
```

Components select the data they need through selectors. When the engine updates state (via the
processing loop), Zustand triggers re-renders in subscribed components automatically.

No `engine.on()` event subscription. No event-to-state mapping logic. The engine's state store is
the single source of truth — the TUI reads it reactively.

### TUI-Local Store

The TUI maintains a separate Zustand store for UI-only state. This store is independent of the
engine store.

```ts
interface TUILocalState {
  selectedWorkItem: string | null;
  pinnedWorkItem: string | null;
  focusedPane: "workItemList" | "detailPane";
  shuttingDown: boolean;
  streamBuffers: Map<string, string[]>;
  detailCache: Map<string, CachedDetail>;
}
```

```ts
interface CachedDetail {
  body: string | null;
  revisionFiles: RevisionFile[] | null;
  loading: boolean;
}
```

`RevisionFile` is defined in
[control-plane-engine-github-provider.md: RevisionFile](./control-plane-engine-github-provider.md#revisionfile).

| Field              | Description                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectedWorkItem` | Work item ID of the highlighted item in the list. `null` when the list is empty.                                                                                        |
| `pinnedWorkItem`   | Work item ID shown in the detail pane. `null` until the user presses Enter. Independent of `selectedWorkItem` — pinning locks the detail pane while the user navigates. |
| `focusedPane`      | Which pane receives keyboard input. Toggled by Tab.                                                                                                                     |
| `shuttingDown`     | Set to `true` when the user confirms quit. Drives the shutdown overlay.                                                                                                 |
| `streamBuffers`    | Live agent output buffers, keyed by `sessionID`. Each entry is an array of strings (one per terminal row). Capped at 10,000 lines per session (ring buffer).            |
| `detailCache`      | On-demand detail data for pinned work items, keyed by work item ID. Invalidated when `pinnedWorkItem` changes.                                                          |

#### Stream Buffers

The TUI starts consuming `engine.getAgentStream(sessionID)` when either:

- An `AgentRun` for the pinned work item transitions to `running` (detected via store subscription).
- A work item is pinned and already has an `AgentRun` with status `running` (checked on pin).

Each string from the async iterable is appended to the buffer.

Buffers are capped at **10,000 lines** per session (ring buffer — oldest lines dropped on overflow).

Buffers are cleared when:

- A new agent run starts for the same work item (fresh buffer for the new session).
- The pinned work item changes.

#### Detail Cache

Detail data is fetched on demand when needed for the current detail view:

- **Work item body:** fetched via `engine.getWorkItemBody(id)` when the detail pane displays a body
  view (display statuses: `dispatch`, `pending`, `needs-refinement`, `blocked`).
- **Revision files:** fetched via `engine.getRevisionFiles(id)` when the detail pane displays a
  revision summary view (display status: `approved`).

Cache is invalidated when `pinnedWorkItem` changes. While loading, a loading indicator is shown.

### Actions

User actions produce domain events via `engine.enqueue()`. Navigation and UI state changes update
the TUI-local store directly.

```ts
interface TUIActions {
  dispatchImplementor: (workItemID: string) => void;
  shutdown: () => void;
  selectWorkItem: (workItemID: string) => void;
  pinWorkItem: (workItemID: string) => void;
  cycleFocus: () => void;
}
```

| Action                | Behavior                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| `dispatchImplementor` | `engine.enqueue({ type: 'userRequestedImplementorRun', workItemID })`.        |
| `shutdown`            | Sets `shuttingDown: true`. Calls `engine.stop()`.                             |
| `selectWorkItem`      | Updates `selectedWorkItem` in TUI-local store. No effect on the detail pane.  |
| `pinWorkItem`         | Sets `pinnedWorkItem`. Triggers on-demand fetch of detail data if not cached. |
| `cycleFocus`          | Toggles `focusedPane` between `'workItemList'` and `'detailPane'`.            |

### TUI Selectors

TUI-specific derivations from engine state. These selectors exist only in the TUI module — they are
not engine selectors.

```ts
type Section = "action" | "agents";

interface DisplayWorkItem {
  workItem: WorkItem;
  displayStatus: DisplayStatus;
  section: Section;
  linkedRevision: Revision | null;
  latestRun: AgentRun | null;
  dispatchCount: number;
}
```

| Selector                  | Returns                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getDisplayWorkItems`     | Array of `DisplayWorkItem` — all non-closed work items with computed display status, section, linked revision, and run data.                     |
| `getSortedWorkItems`      | `DisplayWorkItem[]` sorted by section (ACTION first), then by status weight → priority weight → work item ID ascending. See [Sorting](#sorting). |
| `getActionCount`          | Count of work items in the ACTION section.                                                                                                       |
| `getAgentSectionCount`    | Count of work items in the AGENTS section.                                                                                                       |
| `getRunningAgentCount`    | Count of agent runs with status `requested` or `running` (all roles including planner). Used in the quit confirmation.                           |
| `getPlannerDisplayStatus` | `'running'` if `getActivePlannerRun(state)` returns non-null, `'idle'` otherwise.                                                                |

**`dispatchCount`** — total number of `AgentRun` entries (implementor and reviewer roles) for the
work item, regardless of run status. Session-local — resets to 0 on restart.

**`linkedRevision`** — looked up from `EngineState.revisions` using `workItem.linkedRevision`.
`null` if the work item has no linked revision or the revision is not in the store.

**`latestRun`** — the most recent `AgentRun` (by `startedAt`) for the work item, filtered to
implementor and reviewer roles. `null` if no matching runs exist.

### Layout

The TUI renders a fixed-frame terminal UI using Ink (React for the terminal).

#### Structure

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header                                                           planner 💤 │
├──────────────────────────────────┬───────────────────────────────────────────┤
│ Work Item List (left pane)       │ Detail Pane (right pane)                  │
│                                  │                                           │
│ ACTION (N)                       │                                           │
│ ...items...                      │                                           │
│ ─────────────────────────────────│                                           │
│ AGENTS (N)                       │                                           │
│ ...items...                      │                                           │
├──────────────────────────────────┴───────────────────────────────────────────┤
│ Footer: keybinding hints                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Header Bar

Single row. Right-aligned planner status: the text `planner` followed by a status indicator.

| Planner display status | Indicator          |
| ---------------------- | ------------------ |
| `'running'`            | Spinner (animated) |
| `'idle'`               | 💤                 |

#### Footer Bar

Single row. Keybinding hints rendered as a horizontal list. Content depends on `focusedPane`:

- **Work item list focused:**
  `↑↓jk select    <enter> pin    [d]ispatch    [o]pen    [c]opy    [q]uit`
- **Detail pane focused:** `↑↓jk scroll    <tab> back    [o]pen    [c]opy    [q]uit`

The `[d]ispatch` hint is **dimmed** when the selected work item is not dispatch-eligible (see
[Dispatch Eligibility](#dispatch-eligibility)).

#### Pane Layout

Two vertical panes separated by a box-drawing border.

- **Left pane (work item list):** 40% of terminal width, minimum 30 columns.
- **Right pane (detail):** Remainder of terminal width.
- Both panes span the full height between header and footer bars.
- Recomputed on terminal resize.

#### Section Sub-Panes

The left pane is split vertically into two borderless sub-panes of equal height:

- **ACTION** (top) — work items requiring human intervention or awaiting dispatch.
- **AGENTS** (bottom) — work items with active agent runs.

Each sub-pane has a header row and an item area:

- **Sub-pane height:** `floor(pane_height / 2)` rows each. When `pane_height` is odd, the extra row
  goes to the ACTION sub-pane (`ceil(pane_height / 2)` for ACTION, `floor(pane_height / 2)` for
  AGENTS).
- **Item capacity:** sub-pane height − 1 (the header row). Items beyond capacity are not rendered.
- **Header format:** `ACTION (N)` or `AGENTS (N)` when all items fit. When items are truncated:
  `ACTION (V/N)` or `AGENTS (V/N)` where V is visible items and N is total.

Both section headers are always rendered, even when the section has zero items (displayed as `(0)`).
This keeps the layout stable.

Section headers are not selectable — keyboard navigation skips them.

There is no scroll mechanism within sections. If the terminal is too short to display all items, the
overflow indicator `(V/N)` signals that items are cut off.

### Work Item List

#### Row Format

Each work item renders as a single terminal row:

```
{id} {rev} {status} {icon} {title}
```

| Column | Width     | Content                                                            |
| ------ | --------- | ------------------------------------------------------------------ |
| ID     | 6 chars   | `#` + work item ID (e.g., `#311`). Colored by priority.            |
| Rev    | 8 chars   | Revision reference or `—`. Colored by pipeline status.             |
| Status | 10 chars  | Display label from the status mapping table. `WIP` appends `(N)`.  |
| Icon   | 2 chars   | Status icon.                                                       |
| Title  | Remainder | Work item title, truncated with `…` if it exceeds available width. |

##### ID Column — Priority Color

| Priority | Color   |
| -------- | ------- |
| `high`   | Red     |
| `medium` | Yellow  |
| `low`    | Dim     |
| `null`   | Default |

##### Revision Column

When `linkedRevision` is `null`: `—` in dim.

When `linkedRevision` exists: `PR#` + revision ID (e.g., `PR#482`).

Color is determined by pipeline status:

| `pipeline.status`    | Color |
| -------------------- | ----- |
| `failure`            | Red   |
| `pending`            | Dim   |
| `success`            | Green |
| `null` (no pipeline) | Dim   |

##### Status Column — Display Labels

| `DisplayStatus`    | Display    | Icon |
| ------------------ | ---------- | ---- |
| `approved`         | `APPROVED` | ✔    |
| `failed`           | `FAILED`   | 💥   |
| `blocked`          | `BLOCKED`  | ⛔   |
| `needs-refinement` | `REFINE`   | 📝   |
| `dispatch`         | `DISPATCH` | ●    |
| `pending`          | `PENDING`  | ◌    |
| `implementing`     | `WIP(N)`   | 🤖   |
| `reviewing`        | `REVIEW`   | 🔎   |

`WIP(N)` renders the work item's `dispatchCount` as a parenthetical suffix.

#### Sorting

Each section is sorted independently using a three-level sort chain:

**Level 1 — Status weight** (descending):

| `DisplayStatus`    | Weight |
| ------------------ | ------ |
| `approved`         | 100    |
| `failed`           | 90     |
| `blocked`          | 80     |
| `needs-refinement` | 70     |
| `dispatch`         | 50     |
| `pending`          | 50     |
| `implementing`     | 50     |
| `reviewing`        | 50     |

**Level 2 — Priority weight** (descending):

| Priority | Weight |
| -------- | ------ |
| `high`   | 3      |
| `medium` | 2      |
| `low`    | 1      |
| `null`   | 0      |

**Level 3 — Work item ID** (ascending): lexicographic ascending on the string ID.

#### Section Assignment

A work item's section is derived from its display status:

| Section | Display Statuses                                                           |
| ------- | -------------------------------------------------------------------------- |
| ACTION  | `approved`, `failed`, `blocked`, `needs-refinement`, `dispatch`, `pending` |
| AGENTS  | `implementing`, `reviewing`                                                |

#### Selection and Navigation

`selectedWorkItem` tracks the highlighted work item by ID. This is stable across re-renders — if the
list order changes due to a status update, the selection stays on the same work item.

If a re-render causes the selected work item to fall beyond its section's visible capacity, the
selection snaps to the last visible item in that section.

Navigation moves through **visible items only** (items beyond capacity are not reachable). The
selection crosses sections seamlessly:

- ↓ from the last visible ACTION item → first visible AGENTS item. No-op if AGENTS has zero visible
  items.
- ↑ from the first visible AGENTS item → last visible ACTION item. No-op if ACTION has zero visible
  items.
- ↓ from the last visible AGENTS item → no-op.
- ↑ from the first visible ACTION item → no-op.

When `selectedWorkItem` is `null` (empty list or selected work item was removed), the first
navigation keypress selects the first visible work item in sort order.

#### Work Item Removal

When a work item is removed from the engine store (deleted from `EngineState.workItems`), the TUI
detects the change via store subscription:

- If the removed work item was `selectedWorkItem`, set selection to the next work item in the sorted
  list (cross-section if at a section boundary, previous item if at the end of AGENTS). If no work
  items remain, set to `null`.
- If the removed work item was `pinnedWorkItem`, set `pinnedWorkItem` to `null` and clear the detail
  cache entry.
- Clear the stream buffer entry for any agent session associated with the removed work item.

#### Empty States

When a section has zero items, the section header renders with `(0)`. No placeholder text.

When both sections are empty: `selectedWorkItem` is `null`. Keyboard navigation is a no-op.

### Detail Pane

The right pane displays contextual information for the pinned work item. Content is determined by
the pinned work item's current display status — when the display status changes, the detail pane
switches content automatically. On any display status change, the detail pane's scroll position
resets. For static content views (work item body, revision summary, failure detail), the viewport
resets to offset 0 (top). For agent stream views, auto-scroll resumes from the tail.

When `pinnedWorkItem` is `null`, the detail pane renders `No work item selected`.

#### Content by Display Status

| `DisplayStatus`    | Content                          | Data Source                                                                       |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------------- |
| `dispatch`         | Work item body                   | `engine.getWorkItemBody(id)` → `detailCache`                                      |
| `pending`          | Work item body                   | `engine.getWorkItemBody(id)` → `detailCache`                                      |
| `implementing`     | Live agent output stream         | `engine.getAgentStream(sessionID)` → `streamBuffers`                              |
| `reviewing`        | Live agent output stream         | `engine.getAgentStream(sessionID)` → `streamBuffers`                              |
| `needs-refinement` | Work item body                   | `engine.getWorkItemBody(id)` → `detailCache`                                      |
| `blocked`          | Work item body                   | `engine.getWorkItemBody(id)` → `detailCache`                                      |
| `approved`         | Revision summary                 | `Revision` from store + `engine.getRevisionFiles(linkedRevision)` → `detailCache` |
| `failed`           | Failure details and run metadata | `AgentRun` from store (no fetch needed)                                           |

#### Work Item Body View

Displayed for `dispatch`, `pending`, `needs-refinement`, and `blocked` display statuses.

Content:

1. Work item ID and title (header).
2. Priority and complexity labels (if set).
3. Work item body (fetched via `engine.getWorkItemBody(id)`, rendered as plain text, line-wrapped to
   pane width).

While loading, display the work item ID and title with `Loading...` below.

#### Agent Stream View

Displayed for `implementing` and `reviewing` display statuses.

The stream buffer is read from `streamBuffers[latestRun.sessionID]`. Each buffer entry is one
terminal row, rendered 1:1.

**Auto-scroll:** Viewport is pinned to the tail of the buffer (last N lines displayed, where N =
pane height). New lines push the viewport forward.

**Scroll pause:** When the user scrolls up (j/k or ↑/↓), auto-scroll pauses. The viewport stays at
the user's position while new lines continue appending to the buffer.

**Scroll resume:** Auto-scroll resumes when the user scrolls the viewport back to the bottom (offset
≥ buffer length − visible line count).

**Buffer cap:** 10,000 lines per session (ring buffer). When the cap is reached, the oldest line is
dropped. If auto-scroll is paused and a line is dropped from the front, the viewport offset
decrements by 1 to keep the same content visible. If the offset reaches 0, auto-scroll resumes.

**Stream end:** When the agent completes or fails, the stream stops producing new lines. The buffer
is retained and viewable until the display status changes or a new agent starts for the same work
item (which clears the buffer).

#### Revision Summary View

Displayed for `approved` display status. This view is only reachable when `linkedRevision` is
non-null — a work item cannot reach `approved` status without a linked revision passing review.

Content:

1. Revision ID and title.
2. Revision URL.
3. Pipeline status (from `Revision.pipeline`). If `pipeline.status` is `failure`, display
   `pipeline.reason` (if available).
4. Changed files count (from `engine.getRevisionFiles(workItem.linkedRevision)`).

While loading revision files, display the revision ID and title with `Loading...` below.

#### Failure Detail View

Displayed for `failed` display status.

Content read from `latestRun` (the most recent `AgentRun` for the work item):

1. **Agent role** — `Implementor` or `Reviewer`.
2. **Error message** — from `latestRun.error`. Rendered in red.
3. **Session ID** — from `latestRun.sessionID`.
4. **Branch name** — from `latestRun.branchName` (implementor runs only, if present).
5. **Log file** — from `latestRun.logFilePath` (if present). Rendered as an OSC 8 terminal hyperlink
   (`file://{logFilePath}`).
6. **Retry hint** — `Press [d] to retry` (shown only when `latestRun.role` is `'implementor'`).

No fetch needed — all data is on the `AgentRun` in the store.

#### Detail Pane Scrolling

When the detail pane is focused (via Tab), `j`/`k` and `↑`/`↓` scroll the content vertically.

For static content views (work item body, revision summary, failure detail): scroll moves the
viewport by one row per keypress.

For the agent stream view: scroll behaves as described in [Agent Stream View](#agent-stream-view)
(pauses/resumes auto-scroll).

### Keybindings

#### Focus Model

The TUI has two focusable panes: **work item list** and **detail pane**. `focusedPane` determines
which pane receives keyboard input. Tab toggles between them.

The work item list is focused on startup.

#### Global Keys

These keys are active regardless of which pane is focused.

| Key   | Action                                                                               |
| ----- | ------------------------------------------------------------------------------------ |
| `Tab` | Toggle `focusedPane` between `workItemList` and `detailPane`.                        |
| `o`   | Open the relevant URL in the system browser (see [URL Resolution](#url-resolution)). |
| `c`   | Copy the relevant URL to the system clipboard.                                       |
| `q`   | Show quit confirmation prompt.                                                       |

#### Work Item List Keys

Active when `focusedPane` is `workItemList`.

| Key       | Action                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `↑` / `k` | Move selection to previous visible item. No-op at top of ACTION.                                                   |
| `↓` / `j` | Move selection to next visible item. No-op at bottom of AGENTS.                                                    |
| `Enter`   | Pin the selected work item. Sets `pinnedWorkItem` to `selectedWorkItem`. No-op when `selectedWorkItem` is `null`.  |
| `d`       | Dispatch — show confirmation prompt for the selected work item. See [Dispatch Eligibility](#dispatch-eligibility). |

#### Detail Pane Keys

Active when `focusedPane` is `detailPane`.

| Key       | Action                          |
| --------- | ------------------------------- |
| `↑` / `k` | Scroll content up by one row.   |
| `↓` / `j` | Scroll content down by one row. |

#### Dispatch Eligibility

The `d` key is active when the selected work item's display status is:

- `dispatch` — dispatches a new implementor run.
- `failed` AND `latestRun.role === 'implementor'` — retries the implementor.

For all other display statuses, or when `failed` with a reviewer run, `d` is a no-op.

> **Rationale:** Only `UserRequestedImplementorRun` exists as a user dispatch event.
> `UserRequestedReviewerRun` is a future extension (see [Known Limitations](#known-limitations)). A
> failed reviewer re-enters the dispatch cycle through automated recovery — the handler transitions
> the work item back to `pending`, and the standard pipeline handles re-dispatch.

#### URL Resolution

The `o` and `c` keys resolve a URL from the **target work item**: `selectedWorkItem` when the work
item list is focused, `pinnedWorkItem` when the detail pane is focused. If the target is `null`,
both keys are no-ops.

| `DisplayStatus`    | URL                                                        |
| ------------------ | ---------------------------------------------------------- |
| `dispatch`         | Work item URL                                              |
| `pending`          | Work item URL                                              |
| `implementing`     | Revision URL if linked revision exists, else work item URL |
| `reviewing`        | Revision URL if linked revision exists, else work item URL |
| `needs-refinement` | Work item URL                                              |
| `blocked`          | Work item URL                                              |
| `approved`         | Revision URL if linked revision exists, else work item URL |
| `failed`           | Work item URL                                              |

Work item URL: constructed from `TUIConfig` as
`https://github.com/{repoOwner}/{repoName}/issues/{workItem.id}`.

Revision URL: read from `Revision.url` (populated by the provider).

```ts
interface TUIConfig {
  repoOwner: string;
  repoName: string;
}
```

The TUI receives `TUIConfig` at construction time. These fields are used exclusively for URL
construction — the engine handles all repository interaction through its provider layer.

> **Rationale:** `WorkItem` does not carry a URL in the domain model. The TUI constructs work item
> URLs from repository configuration. Revision URLs come from the domain type directly.

#### Confirmation Prompts

Confirmation prompts render as a centered overlay. Only one prompt can be active at a time. While a
prompt is visible, all other key handlers are suspended — only `y`, `n`, and `Escape` are active.

##### Dispatch Prompt

Triggered by `d` on a work item with `dispatch` display status.

```
Dispatch Implementor for #{id}? [y/n]
```

On `y`: call `dispatchImplementor(workItemID)`. On `n` / `Escape`: dismiss.

##### Retry Prompt

Triggered by `d` on a work item with `failed` display status (implementor failure only).

```
Retry Implementor for #{id}? [y/n]
```

On `y`: call `dispatchImplementor(workItemID)`. On `n` / `Escape`: dismiss.

##### Quit Prompt

Triggered by `q`.

When agents are running: `Quit? {N} agent(s) running. [y/n]` where N is `getRunningAgentCount`.

When no agents are running: `Quit? [y/n]`.

On `y`: call `shutdown()`. On `n` / `Escape`: dismiss.

### Startup and Shutdown

#### Startup Sequence

1. Create the engine via `createEngine(config)`.
2. Set up TUI component subscriptions to `engine.store` via `useStore`. Subscriptions are
   established before `engine.start()` to avoid missing state from the initial poll.
3. Call `engine.start()`. Display a centered loading spinner with `Starting...` text. The two-pane
   layout is not rendered during this phase.
4. On resolution: render the two-pane layout. `focusedPane` is set to `workItemList`.
   `selectedWorkItem` is set to the first work item in sort order (or `null` if no work items).
   `pinnedWorkItem` is `null`.

> **Rationale:** `createEngine` is synchronous, allowing the TUI to establish store subscriptions
> before any events are processed. `engine.start()` runs the first poll cycle of all pollers and
> populates the store. By the time the TUI renders, all current-state entities are available.

#### Shutdown Sequence

1. User presses `q` — quit confirmation shows `getRunningAgentCount`.
2. On `y`: `shuttingDown` set to `true`. `engine.stop()` called.
3. Display `Shutting down...` overlay. If agents are running, show
   `Shutting down... waiting for {N} agent(s)`. Count updates as agent runs reach terminal states
   (observed via store subscription on `agentRuns`).
4. Process exits when `engine.stop()` resolves.

## Acceptance Criteria

### Display Status Derivation

- [ ] Given a work item with an active implementor run (`status: running`) and
      `WorkItemStatus: pending`, when display status is derived, then the result is `implementing`
      (active agent overrides raw status)
- [ ] Given a work item with a failed implementor run (most recent, no active run) and
      `WorkItemStatus: ready`, when display status is derived, then the result is `failed` (failure
      override)
- [ ] Given a work item with a failed implementor run followed by a new run in `requested` status,
      when display status is derived, then the result is `implementing` (active agent clears
      failure)
- [ ] Given a work item with `WorkItemStatus: closed`, when the work item list renders, then the
      work item is excluded
- [ ] Given a work item with a timed-out reviewer run (most recent, no active run), when display
      status is derived, then the result is `failed`
- [ ] Given a work item with a cancelled agent run (most recent, no active run) and
      `WorkItemStatus: ready`, when display status is derived, then the result is `dispatch`
      (cancelled does not trigger failure override)

### State Subscription

- [ ] Given the engine processes a `WorkItemChanged` event that transitions a work item from `ready`
      to `in-progress`, when the store updates, then the TUI re-renders the work item with
      `implementing` display status without explicit event handling
- [ ] Given the engine processes a `PlannerRequested` event, when the store updates with a new
      `PlannerRun`, then the planner status indicator switches from 💤 to spinner

### Work Item Removal

- [ ] Given a work item is removed from the engine store and it is the `selectedWorkItem`, when the
      store subscription fires, then `selectedWorkItem` moves to the next work item in sort order
- [ ] Given a work item is removed from the engine store and it is the `pinnedWorkItem`, when the
      store subscription fires, then `pinnedWorkItem` is set to `null` and the detail pane shows
      `No work item selected`

### Section Assignment and Sorting

- [ ] Given work items with display statuses `approved`, `failed`, `blocked`, `needs-refinement`,
      `dispatch`, and `pending`, when the list renders, then all appear in the ACTION section
- [ ] Given work items with display statuses `implementing` and `reviewing`, when the list renders,
      then all appear in the AGENTS section
- [ ] Given two ACTION work items with the same status weight but different priorities, when sorted,
      then the higher-priority work item appears first
- [ ] Given two work items with the same status weight and priority, when sorted, then the lower
      work item ID appears first

### Section Sub-Panes

- [ ] Given the ACTION section has more items than its sub-pane capacity, when rendered, then the
      header displays `ACTION (V/N)` and excess items are not rendered
- [ ] Given the ACTION section has zero items, when rendered, then the header displays `ACTION (0)`
- [ ] Given the user presses ↓ on the last visible ACTION item, when AGENTS has visible items, then
      the selection moves to the first AGENTS item
- [ ] Given the user presses ↓ on the last visible AGENTS item, then nothing happens

### Detail Pane

- [ ] Given no work item is pinned, when the detail pane renders, then it displays
      `No work item selected`
- [ ] Given a pinned work item transitions from `implementing` to `approved`, when the display
      status changes, then the detail pane switches from stream view to revision summary view and
      scroll resets to top
- [ ] Given a pinned work item has `failed` display status with an implementor run, when the detail
      pane renders, then it displays the error message, session ID, branch name, log file link, and
      retry hint
- [ ] Given a pinned work item has `failed` display status with a reviewer run, when the detail pane
      renders, then the retry hint is not shown

### Keybindings and Dispatch

- [ ] Given the selected work item has `dispatch` display status, when `d` is pressed, then a
      dispatch confirmation prompt is shown
- [ ] Given the selected work item has `failed` display status with an implementor failure, when `d`
      is pressed, then a retry confirmation prompt is shown
- [ ] Given the selected work item has `failed` display status with a reviewer failure, when `d` is
      pressed, then nothing happens
- [ ] Given the selected work item has `blocked` display status, when `d` is pressed, then nothing
      happens
- [ ] Given a confirmation prompt is visible, when any key other than `y`, `n`, or `Escape` is
      pressed, then the key is ignored
- [ ] Given the `[d]ispatch` footer hint, when the selected work item is not dispatch-eligible, then
      the hint is rendered in dim
- [ ] Given the work item list is focused, when Tab is pressed, then `focusedPane` changes to
      `detailPane` and the footer hints update
- [ ] Given the detail pane is focused and a work item is pinned, when `o` is pressed, then the URL
      is resolved from the pinned work item (not the selected work item)
- [ ] Given `selectedWorkItem` is `null`, when `Enter` is pressed, then nothing happens
- [ ] Given dispatch confirmation is accepted, when the event is enqueued, then it flows through the
      engine's standard pipeline including concurrency guards and policy checks

### Agent Streams

- [ ] Given a pinned work item whose latest agent run transitions to `running`, when the TUI detects
      the change, then it starts consuming `engine.getAgentStream(sessionID)` and appending to the
      stream buffer
- [ ] Given the stream buffer reaches 10,000 lines, when a new line is appended, then the oldest
      line is dropped (ring buffer)
- [ ] Given auto-scroll is paused and a line is dropped from the front of the buffer, when the drop
      occurs, then the viewport offset decrements by 1

### Startup and Shutdown

- [ ] Given the TUI starts, when store subscriptions are established, then they are registered
      before `engine.start()` is called
- [ ] Given the user confirms quit with running agents, when `engine.stop()` is called, then the
      overlay updates the agent count as runs reach terminal states

## Known Limitations

- Revisions with no linked work item (`workItemID: null`) are not surfaced in the TUI.
- `dispatchCount` is session-local. It resets to 0 on restart because the control plane uses
  ephemeral state.
- Items beyond section sub-pane capacity are not reachable via keyboard navigation. The `(V/N)`
  overflow indicator signals truncation, but the user cannot scroll to hidden items.
- Reviewer dispatch from the TUI is not supported. Only implementor runs can be dispatched via the
  `d` key. Reviewer dispatch is automated (triggered by pipeline success on linked revisions).
  `UserRequestedReviewerRun` support is a planned extension.
- Work item URLs are constructed from TUI configuration using GitHub URL format. Revision URLs are
  provider-agnostic (from `Revision.url`).
- Run cancellation (`UserCancelledRun`) and manual status transitions (`UserTransitionedStatus`) are
  defined in the architecture but not currently surfaced in the TUI. No keybindings or UI elements
  trigger these events. When implemented, they will use `engine.enqueue()` per the architecture
  contract.

## Dependencies

- [control-plane-engine.md](./control-plane-engine.md) — engine public interface (`store`, `start`,
  `stop`, `enqueue`, `getState`, `getWorkItemBody`, `getRevisionFiles`, `getAgentStream`,
  `refresh`).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `AgentRun` variants, selectors (`getActivePlannerRun`, `isAgentRunningForWorkItem`).
- [domain-model.md](./domain-model.md) — domain types (`WorkItem`, `Revision`, `EngineEvent`,
  `WorkItemStatus`, `Priority`).
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `RevisionFile` type.
- Ink — React for the terminal.
- Zustand — state management (React binding via `useStore`).

## References

- [control-plane-engine.md](./control-plane-engine.md) — engine spec (v1.0.0).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — state store spec.
