---
title: Control Plane Engine — Revision Poller
version: 0.3.0
last_updated: 2026-02-17
status: approved
---

# Control Plane Engine — Revision Poller

## Overview

The RevisionPoller monitors revisions for changes by polling a provider reader and diffing against
the canonical state store. It is a pure event source — it detects differences and enqueues
`RevisionChanged` events. It does not make dispatch decisions.

## Constraints

- Must not make dispatch decisions or execute commands. The RevisionPoller produces events; handlers
  decide what to do.
- Only emits `RevisionChanged` events — no other event types.
- Does not write to the state store. Receives `getState` for diffing and `enqueue` for event
  production.
- RevisionPoller errors are non-fatal — the engine continues operating.

## Specification

### Poll Cycle

The RevisionPoller runs on its own interval.

**Poll cycle steps:**

1. Call `reader.listRevisions()` to get the current set of normalized revisions from the provider.
2. Read the current state via `getState()` to obtain `EngineState.revisions`.
3. Diff the provider result against the store (see [Diff Logic](#diff-logic)).
4. Enqueue a `RevisionChanged` event for each detected difference.

**Initial poll cycle:** On the first cycle, the store is empty. All revisions from the provider are
treated as new — each produces a `RevisionChanged` event with `oldPipelineStatus: null`. This is how
the engine populates the initial revision set.

**Startup burst:** The first poll cycle may enqueue events for all existing revisions
simultaneously. This is intentional — on startup (or restart), the engine should bring the system to
the correct state via normal event processing.

**First-cycle execution:** `Engine.start()` runs the first poll cycle of each poller as a direct
invocation, not via the interval timer. It awaits all first cycles before resolving. Interval-based
polling begins after the first cycles complete.

> **Rationale:** This ensures the state store is populated with the initial revision set before
> `start()` resolves.

### Diff Logic

The poller compares each revision from the provider result against the stored entity to detect three
categories of change:

**New revisions:** Revisions in the provider result whose `id` is not present in the store. Emit:

```ts
RevisionChanged {
  type:              'revisionChanged'
  revisionID:        providerRevision.id
  workItemID:        providerRevision.workItemID
  revision:          providerRevision
  oldPipelineStatus: null
  newPipelineStatus: providerRevision.pipeline?.status ?? null
}
```

**Changed revisions:** Revisions in both the provider result and the store where any field differs.
Comparison is by structural equality — all fields of `Revision` are compared. If the provider entity
is identical to the stored entity, no event is emitted. Emit:

```ts
RevisionChanged {
  type:              'revisionChanged'
  revisionID:        providerRevision.id
  workItemID:        providerRevision.workItemID
  revision:          providerRevision
  oldPipelineStatus: storedRevision.pipeline?.status ?? null
  newPipelineStatus: providerRevision.pipeline?.status ?? null
}
```

> **Rationale:** The `oldPipelineStatus` / `newPipelineStatus` fields are derived by the poller for
> handler decision-making. The `handleReview` handler uses `newPipelineStatus: 'success'` to trigger
> reviewer dispatch.

**Removed revisions:** Revisions present in the store but absent from the provider result. These
have been closed or merged. Emit:

```ts
RevisionChanged {
  type:              'revisionChanged'
  revisionID:        storedRevision.id
  workItemID:        storedRevision.workItemID
  revision:          storedRevision
  oldPipelineStatus: storedRevision.pipeline?.status ?? null
  newPipelineStatus: null
}
```

> **Rationale:** Symmetric with WorkItem removal (`newStatus: null`). Without removal events, closed
> or merged revisions would accumulate in `EngineState.revisions` indefinitely within a session. The
> store is rebuilt on restart via the initial poll burst, but within a long-running session stale
> entries would grow unbounded. Emitting removal events lets the state update clean them out. The
> cost is minimal — one extra diff case using the same pattern as the WorkItem poller.

### Error Handling

If `reader.listRevisions()` fails (after provider-internal retries are exhausted), the poll cycle is
skipped — no events are emitted. The error is logged. The next interval-triggered poll cycle
proceeds normally.

> **Rationale:** Provider-internal retry handles transient failures. If the call still fails, the
> poller skips the cycle rather than emitting events based on stale or partial data.

### Type Definitions

```ts
interface RevisionPoller {
  poll(): Promise<void>;
  stop(): void; // clears the interval timer; if a poll is in-flight, it runs to completion
}

interface RevisionPollerConfig {
  reader: RevisionProviderReader;
  getState: () => EngineState;
  enqueue: (event: RevisionChanged) => void;
  interval: number; // seconds
}

// createRevisionPoller(config: RevisionPollerConfig): RevisionPoller
```

### Module Location

The poller lives in `engine/pollers/`. Files:

```
engine/pollers/
  create-revision-poller.ts
  create-revision-poller.test.ts
```

## Acceptance Criteria

- [ ] Given the store is empty (first poll cycle), when the provider returns revisions, then each
      emits a `RevisionChanged` event with `oldPipelineStatus: null`.
- [ ] Given a revision's pipeline status changed from `pending` to `success` since the last poll,
      when the poller diffs against the store, then it emits a `RevisionChanged` event with
      `oldPipelineStatus: 'pending'` and `newPipelineStatus: 'success'`.
- [ ] Given a revision's `workItemID` changed (PR body edited with new closing keyword), when the
      poller diffs against the store, then it emits a `RevisionChanged` event reflecting the new
      `workItemID`.
- [ ] Given a revision is present in the store but absent from the provider result (closed or
      merged), when the poller processes the cycle, then it emits a `RevisionChanged` event with
      `newPipelineStatus: null` and `oldPipelineStatus` from the stored entity.
- [ ] Given the provider result is identical to the store for all open revisions, when the poller
      diffs, then no events are emitted.
- [ ] Given the provider reader throws an error, when the poll cycle runs, then no events are
      emitted and the next poll cycle proceeds normally.
- [ ] Given `Engine.start()` is called, when the first RevisionPoller cycle runs, then it is
      executed as a direct invocation (not via the interval timer) and `start()` awaits its
      completion before resolving.
- [ ] Given a revision's `pipeline` is `null` in both the provider result and the store, when the
      poller diffs, then both `oldPipelineStatus` and `newPipelineStatus` are `null` in the emitted
      event.

## Dependencies

- [domain-model.md](./domain-model.md) — Domain types (`Revision`, `RevisionChanged` event,
  `PipelineStatus`).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `revisions` map for diffing.
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `RevisionProviderReader` interface.

## References

- [domain-model.md: Domain Events](./domain-model.md#domain-events) — `RevisionChanged` event
  definition.
- [control-plane-engine.md](./control-plane-engine.md) — Parent engine spec (startup, event
  processing loop).
