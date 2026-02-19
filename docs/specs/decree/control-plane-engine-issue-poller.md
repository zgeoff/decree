---
title: Control Plane Engine — WorkItem Poller
version: 0.5.0
last_updated: 2026-02-16
status: approved
---

# Control Plane Engine — WorkItem Poller

## Overview

The WorkItemPoller monitors work items for changes by polling a provider reader and diffing against
the canonical state store. It is a pure event source — it detects differences and enqueues
`WorkItemChanged` events. It does not make dispatch decisions.

## Constraints

- Must not make dispatch decisions or execute commands. The WorkItemPoller produces events; handlers
  decide what to do.
- Only emits `WorkItemChanged` events — no other event types.
- Does not write to the state store. Receives `getState` for diffing and `enqueue` for event
  production.
- WorkItemPoller errors are non-fatal — the engine continues operating.

## Specification

### Poll Cycle

The WorkItemPoller runs on its own interval.

**Poll cycle steps:**

1. Call `reader.listWorkItems()` to get the current set of normalized work items from the provider.
2. Read the current state via `getState()` to obtain `EngineState.workItems`.
3. Diff the provider result against the store (see [Diff Logic](#diff-logic)).
4. Enqueue a `WorkItemChanged` event for each detected difference.

**Initial poll cycle:** On the first cycle, the store is empty. All work items from the provider are
treated as new — each produces a `WorkItemChanged` event with `oldStatus: null`. This is how the
engine populates the initial work item set.

**Startup burst:** The first poll cycle may enqueue events for all existing work items
simultaneously. This is intentional — on startup (or restart), the engine should bring the system to
the correct state via normal event processing.

**First-cycle execution:** `Engine.start()` runs the first poll cycle of each poller as a direct
invocation, not via the interval timer. It awaits all first cycles before resolving. Interval-based
polling begins after the first cycles complete.

> **Rationale:** This ensures the state store is populated with the initial work item set before
> `start()` resolves.

### Diff Logic

The poller compares each work item from the provider result against the stored entity to detect
three categories of change:

**New items:** Work items in the provider result whose `id` is not present in the store. Emit:

```ts
WorkItemChanged {
  type:      'workItemChanged'
  workItemID: providerItem.id
  workItem:   providerItem
  title:      providerItem.title
  oldStatus:  null
  newStatus:  providerItem.status
  priority:   providerItem.priority
}
```

**Changed items:** Work items in both the provider result and the store where any field differs.
Comparison is by structural equality — all fields of `WorkItem` are compared. If the provider entity
is identical to the stored entity, no event is emitted. Emit:

```ts
WorkItemChanged {
  type:      'workItemChanged'
  workItemID: providerItem.id
  workItem:   providerItem
  title:      providerItem.title
  oldStatus:  storedItem.status
  newStatus:  providerItem.status
  priority:   providerItem.priority
}
```

**Removed items:** Work items present in the store but absent from the provider result. These have
been closed or had their filter label removed. Emit:

```ts
WorkItemChanged {
  type:      'workItemChanged'
  workItemID: storedItem.id
  workItem:   storedItem
  title:      storedItem.title
  oldStatus:  storedItem.status
  newStatus:  null
  priority:   storedItem.priority
}
```

> **Rationale:** Diffing against the canonical state store instead of a poller-internal snapshot
> eliminates the need for the engine core to mutate poller state (the v1 `updateEntry` pattern). The
> store always reflects the latest processed state, so the poller's diff is always against the most
> recent truth.

### Error Handling

If `reader.listWorkItems()` fails (after provider-internal retries are exhausted), the poll cycle is
skipped — no events are emitted. The error is logged. The next interval-triggered poll cycle
proceeds normally.

> **Rationale:** Provider-internal retry handles transient failures. If the call still fails, the
> poller skips the cycle rather than emitting events based on stale or partial data.

### Type Definitions

```ts
interface WorkItemPoller {
  poll(): Promise<void>;
  stop(): void; // clears the interval timer; if a poll is in-flight, it runs to completion
}

interface WorkItemPollerConfig {
  reader: WorkProviderReader;
  getState: () => EngineState;
  enqueue: (event: WorkItemChanged) => void;
  interval: number; // seconds
}

// createWorkItemPoller(config: WorkItemPollerConfig): WorkItemPoller
```

### Module Location

The poller lives in `engine/pollers/`. Files:

```
engine/pollers/
  create-work-item-poller.ts
  create-work-item-poller.test.ts
```

## Acceptance Criteria

- [ ] Given the store is empty (first poll cycle), when the provider returns work items, then each
      emits a `WorkItemChanged` event with `oldStatus: null`.
- [ ] Given a work item's status changed from `pending` to `in-progress` since the last poll, when
      the poller diffs against the store, then it emits a `WorkItemChanged` event with
      `oldStatus: 'pending'` and `newStatus: 'in-progress'`.
- [ ] Given a work item's title changed but its status did not, when the poller diffs against the
      store, then it emits a `WorkItemChanged` event with `oldStatus` and `newStatus` equal to the
      current status.
- [ ] Given a work item is present in the store but absent from the provider result, when the poller
      processes the cycle, then it emits a `WorkItemChanged` event with `newStatus: null` and
      `oldStatus` from the stored entity.
- [ ] Given the provider result is identical to the store, when the poller diffs, then no events are
      emitted.
- [ ] Given the provider reader throws an error, when the poll cycle runs, then no events are
      emitted and the next poll cycle proceeds normally.
- [ ] Given `Engine.start()` is called, when the first WorkItemPoller cycle runs, then it is
      executed as a direct invocation (not via the interval timer) and `start()` awaits its
      completion before resolving.

## Dependencies

- [domain-model.md](./domain-model.md) — Domain types (`WorkItem`, `WorkItemChanged` event).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `workItems` map for diffing.
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `WorkProviderReader` interface.

## References

- [domain-model.md: Domain Events](./domain-model.md#domain-events) — `WorkItemChanged` event
  definition.
- [control-plane-engine.md](./control-plane-engine.md) — Parent engine spec (startup, event
  processing loop).
