import { expect, test, vi } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import type { WorkItem, WorkItemChanged } from '../state-store/types.ts';
import { createWorkItemPoller } from './create-work-item-poller.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupTestState {
  workItems: Map<string, WorkItem>;
  revisions: Map<never, never>;
  specs: Map<never, never>;
  agentRuns: Map<never, never>;
  errors: never[];
  lastPlannedSHAs: Map<never, never>;
}

interface SetupTestResult {
  reader: { listWorkItems: ReturnType<typeof vi.fn> };
  state: SetupTestState;
  events: WorkItemChanged[];
  enqueue: ReturnType<typeof vi.fn>;
  createPoller: () => ReturnType<typeof createWorkItemPoller>;
}

function setupTest(
  options: { providerItems?: WorkItem[]; storedItems?: WorkItem[] } = {},
): SetupTestResult {
  const reader = {
    listWorkItems: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkItemBody: vi.fn(),
  };

  const state = {
    workItems: new Map<string, WorkItem>(),
    revisions: new Map<never, never>(),
    specs: new Map<never, never>(),
    agentRuns: new Map<never, never>(),
    errors: [] as never[],
    lastPlannedSHAs: new Map<never, never>(),
  };

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

  function createPoller(): ReturnType<typeof createWorkItemPoller> {
    return createWorkItemPoller({
      reader,
      getState: () => state,
      enqueue,
      interval: 60,
    });
  }

  return { reader, state, events, enqueue, createPoller };
}

// ---------------------------------------------------------------------------
// WorkItemPoller — first poll with empty store emits new item events
// ---------------------------------------------------------------------------

test('it emits a work item changed event with null old status for each item on the first poll', async () => {
  const items = [
    buildWorkItem({ id: 'wi-1', title: 'First task', status: 'pending', priority: 'medium' }),
    buildWorkItem({ id: 'wi-2', title: 'Second task', status: 'review', priority: 'high' }),
  ];

  const { events, createPoller } = setupTest({ providerItems: items });
  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [],
    storedItems: [storedItem],
  });

  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [item],
    storedItems: [item],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — provider error skips cycle without events
// ---------------------------------------------------------------------------

test('it skips the cycle and emits no events when the provider reader throws', async () => {
  const { reader, events, createPoller } = setupTest();

  reader.listWorkItems.mockRejectedValue(new Error('Network error'));

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — provider error does not affect subsequent cycles
// ---------------------------------------------------------------------------

test('it proceeds normally on the next cycle after a provider error', async () => {
  const item = buildWorkItem({ id: 'wi-1' });
  const { reader, events, createPoller } = setupTest();

  const poller = createPoller();

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

test('it does not start the interval timer before the first poll is invoked', async () => {
  vi.useFakeTimers();

  const { reader, createPoller } = setupTest({ providerItems: [buildWorkItem({ id: 'wi-1' })] });
  const poller = createPoller();

  // Advance past one interval without calling poll — no timer should exist yet
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reader.listWorkItems).not.toHaveBeenCalled();

  poller.stop();
  vi.useRealTimers();
});

test('it starts interval-based polling only after the first direct poll completes', async () => {
  vi.useFakeTimers();

  const { reader, events, createPoller } = setupTest({
    providerItems: [buildWorkItem({ id: 'wi-1' })],
  });
  const poller = createPoller();

  // Direct invocation — first cycle
  await poller.poll();
  expect(reader.listWorkItems).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);

  // Advance past one interval — second cycle should fire automatically
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listWorkItems).toHaveBeenCalledTimes(2);

  poller.stop();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — exposes poll and stop methods
// ---------------------------------------------------------------------------

test('it exposes poll and stop methods on the returned interface', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  expect(typeof poller.poll).toBe('function');
  expect(typeof poller.stop).toBe('function');

  poller.stop();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — stop prevents subsequent interval polls
// ---------------------------------------------------------------------------

test('it prevents subsequent interval polls when stop is called after the first poll', async () => {
  vi.useFakeTimers();

  const { reader, createPoller } = setupTest({
    providerItems: [buildWorkItem({ id: 'wi-1' })],
  });
  const poller = createPoller();

  // First direct poll starts the interval timer
  await poller.poll();
  expect(reader.listWorkItems).toHaveBeenCalledTimes(1);

  // Stop the poller
  poller.stop();

  // Advance time past the interval — no further polls should occur
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reader.listWorkItems).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — stop is safe to call before any poll
// ---------------------------------------------------------------------------

test('it is safe to call stop before any poll has been invoked', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  // Should not throw
  poller.stop();
});

// ---------------------------------------------------------------------------
// WorkItemPoller — structural equality detects blockedBy changes
// ---------------------------------------------------------------------------

test('it emits a work item changed event when blocked-by dependencies change', async () => {
  const storedItem = buildWorkItem({ id: 'wi-1', blockedBy: ['wi-2'] });
  const providerItem = buildWorkItem({ id: 'wi-1', blockedBy: ['wi-2', 'wi-3'] });

  const { events, createPoller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [providerItem],
    storedItems: [storedItem],
  });

  const poller = createPoller();
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

  const { events, createPoller } = setupTest({
    providerItems: [providerUnchanged, providerChanged, providerNew],
    storedItems: [storedUnchanged, storedChanged, storedRemoved],
  });

  const poller = createPoller();
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
  const { events, createPoller } = setupTest();
  const poller = createPoller();

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WorkItemPoller — interval fires poll automatically after first direct poll
// ---------------------------------------------------------------------------

test('it fires multiple automatic polls via the interval timer', async () => {
  vi.useFakeTimers();

  const item = buildWorkItem({ id: 'wi-1' });
  const { reader, createPoller } = setupTest({ providerItems: [item] });
  const poller = createPoller();

  // First direct poll to start the interval
  await poller.poll();
  expect(reader.listWorkItems).toHaveBeenCalledTimes(1);

  // Advance past first interval — second poll
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listWorkItems).toHaveBeenCalledTimes(2);

  // Advance past second interval — third poll
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listWorkItems).toHaveBeenCalledTimes(3);

  poller.stop();
  vi.useRealTimers();
});
