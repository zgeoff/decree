---
title: Control Plane Testing
version: 0.1.0
last_updated: 2026-02-20
status: approved
---

# Control Plane Testing

## Overview

Test utility catalog, mock factories, and component testing patterns for the control plane engine.
Extracted from [control-plane.md](./control-plane.md) to keep the top-level spec focused on
architecture and behavior.

## Specification

### Testing Strategy

The architecture is designed for testability. Handlers, selectors, and state updates are pure
functions — test them with direct calls. Providers and runtime adapters are behind interfaces — mock
them at the boundary. All component dependencies are injected, never imported directly.

### Test Utility Catalog

Test utilities live in `src/test-utils/`, one per file, following the standard file organization
rules. Every component test imports from this shared set — no inline mocks, no per-test-file mock
factories.

**Entity Builders** — Factory functions that return domain entities with sensible defaults. Accept
an optional overrides parameter for test-specific values.

```
test-utils/build-work-item.ts         → buildWorkItem(overrides?)
test-utils/build-revision.ts          → buildRevision(overrides?)
test-utils/build-spec.ts              → buildSpec(overrides?)
test-utils/build-planner-run.ts       → buildPlannerRun(overrides?)
test-utils/build-implementor-run.ts   → buildImplementorRun(overrides?)
test-utils/build-reviewer-run.ts      → buildReviewerRun(overrides?)
```

**State Builders** — Build `EngineState` snapshots from entity builders.

```
test-utils/build-engine-state.ts      → buildEngineState(overrides?)
```

`buildEngineState` is the primary test setup tool for handlers and selectors. It accepts
`Partial<EngineState>` — all collection fields are `Map`s, matching the store shape:

```
state = buildEngineState({
  workItems: new Map([['1', buildWorkItem({ id: '1', status: 'ready' })]]),
  revisions: new Map([['10', buildRevision({ id: '10', workItemID: '1' })]]),
  agentRuns: new Map([['session-1', buildImplementorRun({ workItemID: '1', status: 'running' })]]),
})
```

**Event Builders** — Factory functions for domain events.

```
test-utils/build-work-item-changed-upsert.ts         → buildWorkItemChangedUpsert(overrides?)
test-utils/build-work-item-changed-removal.ts        → buildWorkItemChangedRemoval(overrides?)
test-utils/build-revision-changed-event.ts           → buildRevisionChangedEvent(overrides?)
test-utils/build-spec-changed-event.ts               → buildSpecChangedEvent(overrides?)
test-utils/build-planner-requested-event.ts          → buildPlannerRequestedEvent(overrides?)
test-utils/build-planner-started-event.ts            → buildPlannerStartedEvent(overrides?)
test-utils/build-planner-completed-event.ts          → buildPlannerCompletedEvent(overrides?)
test-utils/build-planner-failed-event.ts             → buildPlannerFailedEvent(overrides?)
test-utils/build-implementor-requested-event.ts      → buildImplementorRequestedEvent(overrides?)
test-utils/build-implementor-started-event.ts        → buildImplementorStartedEvent(overrides?)
test-utils/build-implementor-completed-event.ts      → buildImplementorCompletedEvent(overrides?)
test-utils/build-implementor-failed-event.ts         → buildImplementorFailedEvent(overrides?)
test-utils/build-reviewer-requested-event.ts         → buildReviewerRequestedEvent(overrides?)
test-utils/build-reviewer-started-event.ts           → buildReviewerStartedEvent(overrides?)
test-utils/build-reviewer-completed-event.ts         → buildReviewerCompletedEvent(overrides?)
test-utils/build-reviewer-failed-event.ts            → buildReviewerFailedEvent(overrides?)
test-utils/build-command-rejected-event.ts           → buildCommandRejectedEvent(overrides?)
test-utils/build-command-failed-event.ts             → buildCommandFailedEvent(overrides?)
```

**Mock Providers** — Mock implementations of provider interfaces. Readers accept initial data;
writers record calls for assertion.

```
test-utils/create-mock-work-provider-reader.ts     → createMockWorkProviderReader(config?)
test-utils/create-mock-work-provider-writer.ts     → createMockWorkProviderWriter()
test-utils/create-mock-revision-provider-reader.ts → createMockRevisionProviderReader(config?)
test-utils/create-mock-revision-provider-writer.ts → createMockRevisionProviderWriter()
test-utils/create-mock-spec-provider-reader.ts     → createMockSpecProviderReader(config?)
```

Mock readers return configured data. Mock writers expose `calls` arrays for assertion:

```
writer = createMockWorkProviderWriter()
// ... execute commands ...
expect(writer.transitionStatus.calls).toContainEqual({ workItemID: '1', newStatus: 'in-progress' })
```

**Mock Runtime and Infrastructure:**

```
test-utils/create-mock-runtime-adapter.ts   → createMockRuntimeAdapter(config?)
test-utils/create-mock-policy.ts            → createMockPolicy(config?)
test-utils/create-mock-enqueue.ts           → createMockEnqueue()
```

`createMockRuntimeAdapter` returns an adapter whose `startAgent` produces a controllable
`AgentRunHandle` — tests can resolve or reject the result promise to simulate completion or failure.

`createMockPolicy` defaults to allowing all commands. Pass overrides to reject specific command
types.

`createMockEnqueue` captures enqueued events in an array for assertion.

### Testing Patterns by Component

| Component                | Pattern                                                                                                                                                       | Key utilities                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Handlers**             | Pure function test. Call `handler(event, state)`, assert returned commands.                                                                                   | `buildEngineState`, event builders                                    |
| **Selectors**            | Pure function test. Call `selector(state)`, assert derived value.                                                                                             | `buildEngineState`                                                    |
| **State updates**        | Call `applyStateUpdate(store, event, logger)`, assert state changes via `store.getState()`.                                                                   | Event builders, fresh Zustand store                                   |
| **CommandExecutor**      | Inject mock providers + adapters + policy. Call `execute(command, state)`, assert provider calls and returned events.                                         | Mock providers, mock runtime adapter, mock policy, `buildEngineState` |
| **Pollers**              | Inject mock reader + `getState` + mock enqueue. Trigger a poll cycle, assert enqueued events match the diff between reader data and store state.              | Mock provider readers, `buildEngineState`, `createMockEnqueue`        |
| **Engine (integration)** | Wire real handlers and store with mock providers and adapters. Enqueue events, let the processing loop run, assert resulting state and provider interactions. | All mock utilities, `buildEngineState`                                |

### Testing Principles

- **No inline mocks.** All mocks come from `test-utils/`. If a test needs a mock that doesn't exist,
  add it to `test-utils/` — don't create it locally.
- **Builders over literals.** Use `buildWorkItem({ status: 'ready' })` instead of spelling out full
  object literals. Builders provide sensible defaults and insulate tests from entity shape changes.
- **Assert commands, not side effects.** Handler tests assert the returned `EngineCommand[]`. They
  never assert provider calls — that's the CommandExecutor's concern.
- **One layer per test.** Handler tests don't involve the CommandExecutor. CommandExecutor tests
  don't involve handlers. Integration tests are separate and deliberate.

## Dependencies

- [control-plane.md](./control-plane.md) — Top-level control plane specification; this document
  provides the testing detail referenced there
- [domain-model.md](./domain-model.md) — Domain types used by entity builders and event builders
- [control-plane-engine-state-store.md](./control-plane-engine-state-store.md) — `EngineState` shape
  used by `buildEngineState`

## References

- [control-plane-engine-handlers.md](./control-plane-engine-handlers.md) — Handler testing patterns
- [control-plane-engine-command-executor.md](./control-plane-engine-command-executor.md) —
  CommandExecutor testing patterns
- [control-plane-engine-github-provider.md](./control-plane-engine-github-provider.md) — Provider
  mock interfaces
- [control-plane-engine-runtime-adapter.md](./control-plane-engine-runtime-adapter.md) — Runtime
  adapter mock interface
