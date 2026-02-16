import { expect, test, vi } from 'vitest';
import type { WorkItem, WorkItemChanged } from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';
import { createWorkItemPoller } from './create-work-item-poller.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWorkItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Work item ${overrides.id}`,
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-02-01T00:00:00Z',
    linkedRevision: null,
    ...overrides,
  };
}

function buildEmptyState(): EngineState {
  return {
    workItems: new Map<string, WorkItem>(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

function setupTest(options: { providerItems?: WorkItem[]; storedItems?: WorkItem[] } = {}): {
  reader: {
    listWorkItems: ReturnType<typeof vi.fn>;
    getWorkItem: ReturnType<typeof vi.fn>;
    getWorkItemBody: ReturnType<typeof vi.fn>;
  };
  state: EngineState;
  events: WorkItemChanged[];
  enqueue: ReturnType<typeof vi.fn>;
  poller: ReturnType<typeof createWorkItemPoller>;
} {
  const reader = {
    listWorkItems: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkItemBody: vi.fn(),
  };

  const state = buildEmptyState();
  if (options.storedItems) {
    for (const item of options.storedItems) {
      state.workItems.set(item.id, item);
    }
  }

  reader.listWorkItems.mockResolvedValue(options.providerItems ?? []);

  const events: WorkItemChanged[] = [];
  const enqueue = vi.fn((event: WorkItemChanged) => {
    events.push(event);
  });

  const poller = createWorkItemPoller({
    reader,
    getState: () => state,
    enqueue,
    interval: 60,
  });

  return { reader, state, events, enqueue, poller };
}

// ---------------------------------------------------------------------------
// WorkItemPoller — first poll with empty store emits new item events
// ---------------------------------------------------------------------------

test('it emits a work item changed event with null old status for each item on the first poll', async () => {
  const items = [
    buildWorkItem({ id: 'wi-1', title: 'First task', status: 'pending', priority: 'medium' }),
    buildWorkItem({ id: 'wi-2', title: 'Second task', status: 'review', priority: 'high' }),
  ];

  const { events, poller } = setupTest({ providerItems: items });
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(2);

  expect(events[0]).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: items[0],
    title: 'First task',
    oldStatus: null,
    newStatus: 'pending',
    priority: 'medium',
  });

  expect(events[1]).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-2',
    workItem: items[1],
    title: 'Second task',
    oldStatus: null,
    newStatus: 'review',
    priority: 'high',
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — status change emits event with old and new status
// ---------------------------------------------------------------------------

test('it emits a work item changed event when the status changes between polls', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const providerItem = buildWorkItem({ id: 'wi-1', status: 'in-progress' });

  const { events, poller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: providerItem,
    title: 'Work item wi-1',
    oldStatus: 'pending',
    newStatus: 'in-progress',
    priority: null,
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — title change emits event with same old and new status
// ---------------------------------------------------------------------------

test('it emits a work item changed event when the title changes but status does not', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', title: 'Original title', status: 'pending' });
  const providerItem = buildWorkItem({ id: 'wi-1', title: 'Updated title', status: 'pending' });

  const { events, poller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: providerItem,
    title: 'Updated title',
    oldStatus: 'pending',
    newStatus: 'pending',
    priority: null,
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — removed item emits event with null new status
// ---------------------------------------------------------------------------

test('it emits a work item changed event with null new status when an item disappears from the provider', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', status: 'in-progress', priority: 'high' });

  const { events, poller } = setupTest({
    providerItems: [],
    storedItems: [storedItem],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: storedItem,
    title: 'Work item wi-1',
    oldStatus: 'in-progress',
    newStatus: null,
    priority: 'high',
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — no events when provider matches store
// ---------------------------------------------------------------------------

test('it emits no events when the provider result is identical to the store', async () => {
  const item = buildWorkItem({ id: 'wi-1' });

  const { events, poller } = setupTest({
    providerItems: [item],
    storedItems: [item],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — provider error skips cycle without events
// ---------------------------------------------------------------------------

test('it skips the cycle and emits no events when the provider reader throws', async () => {
  const { reader, events, poller } = setupTest();

  reader.listWorkItems.mockRejectedValue(new Error('Network error'));

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — provider error does not affect subsequent cycles
// ---------------------------------------------------------------------------

test('it proceeds normally on the next cycle after a provider error', async () => {
  const item = buildWorkItem({ id: 'wi-1' });
  const { reader, events, poller } = setupTest();

  // First poll fails
  reader.listWorkItems.mockRejectedValueOnce(new Error('Transient failure'));
  await poller.poll();
  expect(events).toHaveLength(0);

  // Second poll succeeds with a new item
  reader.listWorkItems.mockResolvedValue([item]);
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: null,
    newStatus: 'pending',
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — first cycle is a direct invocation
// ---------------------------------------------------------------------------

test('it supports direct invocation of poll and awaits completion', async () => {
  const items = [buildWorkItem({ id: 'wi-1' })];
  const { events, poller } = setupTest({ providerItems: items });

  // Direct invocation — not via interval
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: null,
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — exposes poll and stop methods
// ---------------------------------------------------------------------------

test('it exposes poll and stop methods on the returned interface', () => {
  const { poller } = setupTest();

  expect(typeof poller.poll).toBe('function');
  expect(typeof poller.stop).toBe('function');

  poller.stop();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — stop clears the interval timer
// ---------------------------------------------------------------------------

test('it clears the interval timer when stop is called', () => {
  vi.useFakeTimers();

  const { reader, poller } = setupTest();

  poller.stop();

  // Advance time past the interval — poll should not be called
  vi.advanceTimersByTime(120_000);

  // listWorkItems should not have been called since we stopped before any interval fired
  expect(reader.listWorkItems).not.toHaveBeenCalled();

  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — structural equality detects blockedBy changes
// ---------------------------------------------------------------------------

test('it emits a work item changed event when blocked-by dependencies change', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', blockedBy: ['wi-2'] });
  const providerItem = buildWorkItem({ id: 'wi-1', blockedBy: ['wi-2', 'wi-3'] });

  const { events, poller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: 'pending',
    newStatus: 'pending',
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — structural equality detects linked revision changes
// ---------------------------------------------------------------------------

test('it emits a work item changed event when the linked revision changes', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', linkedRevision: null });
  const providerItem = buildWorkItem({ id: 'wi-1', linkedRevision: 'rev-1' });

  const { events, poller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — handles mixed new, changed, and removed items in one cycle
// ---------------------------------------------------------------------------

test('it handles new, changed, and removed items in a single poll cycle', async () => {
  const storedUnchanged = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const storedChanged = buildWorkItem({ id: 'wi-2', status: 'pending' });
  const storedRemoved = buildWorkItem({ id: 'wi-3', status: 'in-progress' });

  const providerUnchanged = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const providerChanged = buildWorkItem({ id: 'wi-2', status: 'in-progress' });
  const providerNew = buildWorkItem({ id: 'wi-4', status: 'pending' });

  const { events, poller } = setupTest({
    providerItems: [providerUnchanged, providerChanged, providerNew],
    storedItems: [storedUnchanged, storedChanged, storedRemoved],
  });

  await poller.poll();
  poller.stop();

  // Expect: changed (wi-2), new (wi-4), removed (wi-3) = 3 events
  expect(events).toHaveLength(3);

  const changedEvent = events.find((e) => e.workItemID === 'wi-2');
  expect(changedEvent).toMatchObject({
    oldStatus: 'pending',
    newStatus: 'in-progress',
  });

  const newEvent = events.find((e) => e.workItemID === 'wi-4');
  expect(newEvent).toMatchObject({
    oldStatus: null,
    newStatus: 'pending',
  });

  const removedEvent = events.find((e) => e.workItemID === 'wi-3');
  expect(removedEvent).toMatchObject({
    oldStatus: 'in-progress',
    newStatus: null,
  });
});

// ---------------------------------------------------------------------------
// WorkItemPoller — empty provider and empty store emits no events
// ---------------------------------------------------------------------------

test('it emits no events when both the provider and store are empty', async () => {
  const { events, poller } = setupTest();

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — interval fires poll automatically
// ---------------------------------------------------------------------------

test('it fires poll automatically via the interval timer', async () => {
  vi.useFakeTimers();

  const item = buildWorkItem({ id: 'wi-1' });
  const { reader, events, poller } = setupTest({ providerItems: [item] });

  // Advance past one interval (60s = 60000ms)
  await vi.advanceTimersByTimeAsync(60_000);

  expect(reader.listWorkItems).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);

  poller.stop();
  vi.useRealTimers();
});
