---
title: Control Plane Engine — Spec Poller
version: 0.5.0
last_updated: 2026-02-16
status: approved
---

# Control Plane Engine — Spec Poller

## Overview

The SpecPoller monitors spec files for changes by polling a provider reader and diffing against the
canonical state store. It is a pure event source — it detects differences and enqueues `SpecChanged`
events for additions and modifications. It does not make dispatch decisions.

## Constraints

- Must not make dispatch decisions or execute commands. The SpecPoller produces events; handlers
  decide what to do.
- Only emits `SpecChanged` events — no other event types.
- Does not write to the state store. Receives `getState` for diffing and `enqueue` for event
  production.
- SpecPoller errors are non-fatal — the engine continues operating.

## Specification

### Poll Cycle

The SpecPoller runs on its own interval.

**Poll cycle steps:**

1. Call `reader.listSpecs()` to get the current set of spec files from the provider.
2. Read the current state via `getState()` to obtain `EngineState.specs`.
3. Diff the provider result against the store (see [Diff Logic](#diff-logic)).
4. If any changes are detected, call `reader.getDefaultBranchSHA()` to obtain the current commit
   SHA.
5. Enqueue a `SpecChanged` event for each detected difference.

> **Rationale:** `getDefaultBranchSHA` is called only when changes are detected, avoiding an extra
> API call on cycles where nothing changed.

**No removal events:** The SpecPoller does not emit events for spec files that are present in the
store but absent from the provider result. The `SpecChanged` event defines `changeType` as
`'added' | 'modified'` only — there is no removal variant.

> **Rationale:** Spec file deletion is rare. Deleted specs remain in the store but do not trigger
> further handler activity because no new `SpecChanged` events are emitted for them.

**Initial poll cycle:** On the first cycle, the store is empty. All specs from the provider are
treated as additions — each produces a `SpecChanged` event with `changeType: 'added'`.

**First-cycle execution:** `Engine.start()` runs the first poll cycle of each poller as a direct
invocation, not via the interval timer. It awaits all first cycles before resolving. Interval-based
polling begins after the first cycles complete.

> **Rationale:** This ensures the state store is populated with the initial spec set before
> `start()` resolves. The initial `SpecChanged` events feed the planning handler, which uses
> `lastPlannedSHAs` to determine which specs need planning — no snapshot seeding is needed.

### Diff Logic

The poller compares each spec from the provider result against the stored entity to detect two
categories of change:

**Added specs:** Specs in the provider result whose `filePath` is not present in the store. Emit:

```ts
SpecChanged {
  type:              'specChanged'
  filePath:          providerSpec.filePath
  blobSHA:           providerSpec.blobSHA
  frontmatterStatus: providerSpec.frontmatterStatus
  changeType:        'added'
  commitSHA:         commitSHA
}
```

**Modified specs:** Specs in both the provider result and the store where `blobSHA` or
`frontmatterStatus` differs. If both fields are identical, no event is emitted. Emit:

```ts
SpecChanged {
  type:              'specChanged'
  filePath:          providerSpec.filePath
  blobSHA:           providerSpec.blobSHA
  frontmatterStatus: providerSpec.frontmatterStatus
  changeType:        'modified'
  commitSHA:         commitSHA
}
```

> **Rationale:** `blobSHA` comparison detects content changes. `frontmatterStatus` comparison
> detects status-only changes that may not alter the blob (e.g., if frontmatter is stored
> separately). In practice, any content change produces a different `blobSHA`, so comparing both
> fields is a defensive measure.

### Error Handling

If `reader.listSpecs()` fails (after provider-internal retries are exhausted), the poll cycle is
skipped — no events are emitted. The error is logged. The next interval-triggered poll cycle
proceeds normally.

If `reader.getDefaultBranchSHA()` fails after changes were detected, the poll cycle is skipped — no
events are emitted for that cycle. The next cycle re-detects the same changes (the store was not
updated) and retries.

> **Rationale:** Provider-internal retry handles transient failures. If the call still fails, the
> poller skips the cycle rather than emitting events with missing commit metadata.

The `commitSHA` field on `SpecChanged` events is consumed by the TUI to construct diff URLs (e.g.,
GitHub compare links) for spec changes.

### Type Definitions

```ts
interface SpecPoller {
  poll(): Promise<void>;
  stop(): void; // clears the interval timer; if a poll is in-flight, it runs to completion
}

interface SpecPollerConfig {
  reader: SpecProviderReader;
  getState: () => EngineState;
  enqueue: (event: SpecChanged) => void;
  interval: number; // seconds
}

// createSpecPoller(config: SpecPollerConfig): SpecPoller
```

### Module Location

The poller lives in `engine/pollers/`. Files:

```
engine/pollers/
  create-spec-poller.ts
  create-spec-poller.test.ts
```

## Acceptance Criteria

- [ ] Given the store is empty (first poll cycle), when the provider returns specs, then each emits
      a `SpecChanged` event with `changeType: 'added'`.
- [ ] Given a spec's `blobSHA` changed since the last poll, when the poller diffs against the store,
      then it emits a `SpecChanged` event with `changeType: 'modified'`.
- [ ] Given a spec's `frontmatterStatus` changed from `draft` to `approved`, when the poller diffs
      against the store, then it emits a `SpecChanged` event with `changeType: 'modified'` and
      `frontmatterStatus: 'approved'`.
- [ ] Given a spec is present in the store but absent from the provider result (file deleted), when
      the poller processes the cycle, then no event is emitted for that spec.
- [ ] Given the provider result is identical to the store, when the poller diffs, then no events are
      emitted and `reader.getDefaultBranchSHA` is not called.
- [ ] Given the provider reader throws an error, when the poll cycle runs, then no events are
      emitted and the next poll cycle proceeds normally.
- [ ] Given `reader.getDefaultBranchSHA` throws an error after changes were detected, when the poll
      cycle runs, then no events are emitted and the next poll cycle re-detects the same changes.
- [ ] Given `Engine.start()` is called, when the first SpecPoller cycle runs, then it is executed as
      a direct invocation (not via the interval timer) and `start()` awaits its completion before
      resolving.

## Dependencies

- [domain-model.md](./domain-model.md) — Domain types (`Spec`, `SpecChanged` event,
  `SpecFrontmatterStatus`).
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState`,
  `specs` map for diffing, `lastPlannedSHAs` (replaces snapshot seeding).
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) —
  `SpecProviderReader` interface.

## References

- [domain-model.md: Domain Events](./domain-model.md#domain-events) — `SpecChanged` event
  definition.
- [control-plane-engine.md](./control-plane-engine.md) — Parent engine spec (startup, event
  processing loop).
