import { expect, test, vi } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import type { PipelineResult, Revision, RevisionChanged } from '../state-store/types.ts';
import { createRevisionPoller } from './create-revision-poller.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupTestState {
  workItems: Map<never, never>;
  revisions: Map<string, Revision>;
  specs: Map<never, never>;
  agentRuns: Map<never, never>;
  errors: never[];
  lastPlannedSHAs: Map<never, never>;
}

interface SetupTestResult {
  reader: { listRevisions: ReturnType<typeof vi.fn> };
  state: SetupTestState;
  events: RevisionChanged[];
  enqueue: ReturnType<typeof vi.fn>;
  createPoller: () => ReturnType<typeof createRevisionPoller>;
}

function buildPipeline(overrides?: Partial<PipelineResult>): PipelineResult {
  return {
    status: 'pending',
    url: null,
    reason: null,
    ...overrides,
  };
}

function setupTest(
  options: { providerRevisions?: Revision[]; storedRevisions?: Revision[] } = {},
): SetupTestResult {
  const reader = {
    listRevisions: vi.fn(),
    getRevision: vi.fn(),
    getRevisionFiles: vi.fn(),
    getReviewHistory: vi.fn().mockResolvedValue({ reviews: [], inlineComments: [] }),
  };

  const state: SetupTestState = {
    workItems: new Map<never, never>(),
    revisions: new Map<string, Revision>(),
    specs: new Map<never, never>(),
    agentRuns: new Map<never, never>(),
    errors: [] as never[],
    lastPlannedSHAs: new Map<never, never>(),
  };

  if (options.storedRevisions) {
    for (const revision of options.storedRevisions) {
      state.revisions.set(revision.id, revision);
    }
  }

  reader.listRevisions.mockResolvedValue(options.providerRevisions ?? []);

  const events: RevisionChanged[] = [];
  const enqueue = vi.fn((event: RevisionChanged) => {
    events.push(event);
  });

  function createPoller(): ReturnType<typeof createRevisionPoller> {
    return createRevisionPoller({
      reader,
      getState: () => state,
      enqueue,
      interval: 60,
    });
  }

  return { reader, state, events, enqueue, createPoller };
}

// ---------------------------------------------------------------------------
// First poll with empty store — emits new revision events
// ---------------------------------------------------------------------------

test('it emits a revision changed event with null old pipeline status for each revision on the first poll', async () => {
  const revisions = [
    buildRevision({ id: 'rev-1', pipeline: buildPipeline({ status: 'pending' }) }),
    buildRevision({ id: 'rev-2', pipeline: buildPipeline({ status: 'success' }) }),
  ];

  const { events, createPoller } = setupTest({ providerRevisions: revisions });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(2);

  expect(events[0]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: null,
    revision: revisions[0],
    oldPipelineStatus: null,
    newPipelineStatus: 'pending',
  });

  expect(events[1]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-2',
    workItemID: null,
    revision: revisions[1],
    oldPipelineStatus: null,
    newPipelineStatus: 'success',
  });
});

// ---------------------------------------------------------------------------
// Pipeline status change emits event with old and new status
// ---------------------------------------------------------------------------

test('it emits a revision changed event when the pipeline status changes between polls', async () => {
  const storedRevision = buildRevision({
    id: 'rev-1',
    pipeline: buildPipeline({ status: 'pending' }),
  });
  const providerRevision = buildRevision({
    id: 'rev-1',
    pipeline: buildPipeline({ status: 'success' }),
  });

  const { events, createPoller } = setupTest({
    providerRevisions: [providerRevision],
    storedRevisions: [storedRevision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: null,
    revision: providerRevision,
    oldPipelineStatus: 'pending',
    newPipelineStatus: 'success',
  });
});

// ---------------------------------------------------------------------------
// workItemID change emits event reflecting the new workItemID
// ---------------------------------------------------------------------------

test('it emits a revision changed event when the work item association changes', async () => {
  const storedRevision = buildRevision({ id: 'rev-1', workItemID: 'wi-1' });
  const providerRevision = buildRevision({ id: 'rev-1', workItemID: 'wi-2' });

  const { events, createPoller } = setupTest({
    providerRevisions: [providerRevision],
    storedRevisions: [storedRevision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-2',
    revision: providerRevision,
  });
});

// ---------------------------------------------------------------------------
// Removed revision emits event with null new pipeline status
// ---------------------------------------------------------------------------

test('it emits a revision changed event with null new pipeline status when a revision disappears from the provider', async () => {
  const storedRevision = buildRevision({
    id: 'rev-1',
    pipeline: buildPipeline({ status: 'success' }),
  });

  const { events, createPoller } = setupTest({
    providerRevisions: [],
    storedRevisions: [storedRevision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: null,
    revision: storedRevision,
    oldPipelineStatus: 'success',
    newPipelineStatus: null,
  });
});

// ---------------------------------------------------------------------------
// No events when provider matches store
// ---------------------------------------------------------------------------

test('it emits no events when the provider result is identical to the store', async () => {
  const revision = buildRevision({ id: 'rev-1' });

  const { events, createPoller } = setupTest({
    providerRevisions: [revision],
    storedRevisions: [revision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Provider error skips cycle without events
// ---------------------------------------------------------------------------

test('it skips the cycle and emits no events when the provider reader throws', async () => {
  const { reader, events, createPoller } = setupTest();

  reader.listRevisions.mockRejectedValue(new Error('Network error'));

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Provider error does not affect subsequent cycles
// ---------------------------------------------------------------------------

test('it proceeds normally on the next cycle after a provider error', async () => {
  const revision = buildRevision({ id: 'rev-1' });
  const { reader, events, createPoller } = setupTest();

  const poller = createPoller();

  // First poll fails
  reader.listRevisions.mockRejectedValueOnce(new Error('Transient failure'));
  await poller.poll();
  expect(events).toHaveLength(0);

  // Second poll succeeds with a new revision
  reader.listRevisions.mockResolvedValue([revision]);
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    oldPipelineStatus: null,
  });
});

// ---------------------------------------------------------------------------
// First cycle is a direct invocation — interval starts after
// ---------------------------------------------------------------------------

test('it does not start the interval timer before the first poll is invoked', async () => {
  vi.useFakeTimers();

  const { reader, createPoller } = setupTest({
    providerRevisions: [buildRevision({ id: 'rev-1' })],
  });
  const poller = createPoller();

  // Advance past one interval without calling poll — no timer should exist yet
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reader.listRevisions).not.toHaveBeenCalled();

  poller.stop();
  vi.useRealTimers();
});

test('it starts interval-based polling only after the first direct poll completes', async () => {
  vi.useFakeTimers();

  const { reader, events, createPoller } = setupTest({
    providerRevisions: [buildRevision({ id: 'rev-1' })],
  });
  const poller = createPoller();

  // Direct invocation — first cycle
  await poller.poll();
  expect(reader.listRevisions).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);

  // Advance past one interval — second cycle should fire automatically
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listRevisions).toHaveBeenCalledTimes(2);

  poller.stop();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Null pipeline in both provider and store
// ---------------------------------------------------------------------------

test('it emits an event with both pipeline statuses as null when pipeline is null in provider and store', async () => {
  const storedRevision = buildRevision({ id: 'rev-1', pipeline: null, title: 'Old title' });
  const providerRevision = buildRevision({ id: 'rev-1', pipeline: null, title: 'New title' });

  const { events, createPoller } = setupTest({
    providerRevisions: [providerRevision],
    storedRevisions: [storedRevision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: null,
    revision: providerRevision,
    oldPipelineStatus: null,
    newPipelineStatus: null,
  });
});

// ---------------------------------------------------------------------------
// Exposes poll and stop methods
// ---------------------------------------------------------------------------

test('it exposes poll and stop methods on the returned interface', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  expect(typeof poller.poll).toBe('function');
  expect(typeof poller.stop).toBe('function');

  poller.stop();
});

// ---------------------------------------------------------------------------
// Stop prevents subsequent interval polls
// ---------------------------------------------------------------------------

test('it prevents subsequent interval polls when stop is called after the first poll', async () => {
  vi.useFakeTimers();

  const { reader, createPoller } = setupTest({
    providerRevisions: [buildRevision({ id: 'rev-1' })],
  });
  const poller = createPoller();

  // First direct poll starts the interval timer
  await poller.poll();
  expect(reader.listRevisions).toHaveBeenCalledTimes(1);

  // Stop the poller
  poller.stop();

  // Advance time past the interval — no further polls should occur
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reader.listRevisions).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Stop is safe to call before any poll
// ---------------------------------------------------------------------------

test('it is safe to call stop before any poll has been invoked', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  // Should not throw
  poller.stop();
});

// ---------------------------------------------------------------------------
// Handles mixed new, changed, and removed revisions in one cycle
// ---------------------------------------------------------------------------

test('it handles new, changed, and removed revisions in a single poll cycle', async () => {
  const storedUnchanged = buildRevision({ id: 'rev-1', pipeline: null });
  const storedChanged = buildRevision({
    id: 'rev-2',
    pipeline: buildPipeline({ status: 'pending' }),
  });
  const storedRemoved = buildRevision({
    id: 'rev-3',
    pipeline: buildPipeline({ status: 'success' }),
  });

  const providerUnchanged = buildRevision({ id: 'rev-1', pipeline: null });
  const providerChanged = buildRevision({
    id: 'rev-2',
    pipeline: buildPipeline({ status: 'success' }),
  });
  const providerNew = buildRevision({
    id: 'rev-4',
    pipeline: buildPipeline({ status: 'pending' }),
  });

  const { events, createPoller } = setupTest({
    providerRevisions: [providerUnchanged, providerChanged, providerNew],
    storedRevisions: [storedUnchanged, storedChanged, storedRemoved],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  // Expect: changed (rev-2), new (rev-4), removed (rev-3) = 3 events
  expect(events).toHaveLength(3);

  const changedEvent = events.find((e) => e.revisionID === 'rev-2');
  expect(changedEvent).toMatchObject({
    oldPipelineStatus: 'pending',
    newPipelineStatus: 'success',
  });

  const newEvent = events.find((e) => e.revisionID === 'rev-4');
  expect(newEvent).toMatchObject({
    oldPipelineStatus: null,
    newPipelineStatus: 'pending',
  });

  const removedEvent = events.find((e) => e.revisionID === 'rev-3');
  expect(removedEvent).toMatchObject({
    oldPipelineStatus: 'success',
    newPipelineStatus: null,
  });
});

// ---------------------------------------------------------------------------
// Empty provider and empty store emits no events
// ---------------------------------------------------------------------------

test('it emits no events when both the provider and store are empty', async () => {
  const { events, createPoller } = setupTest();
  const poller = createPoller();

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Interval fires poll automatically after first direct poll
// ---------------------------------------------------------------------------

test('it fires multiple automatic polls via the interval timer', async () => {
  vi.useFakeTimers();

  const revision = buildRevision({ id: 'rev-1' });
  const { reader, createPoller } = setupTest({ providerRevisions: [revision] });
  const poller = createPoller();

  // First direct poll to start the interval
  await poller.poll();
  expect(reader.listRevisions).toHaveBeenCalledTimes(1);

  // Advance past first interval — second poll
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listRevisions).toHaveBeenCalledTimes(2);

  // Advance past second interval — third poll
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reader.listRevisions).toHaveBeenCalledTimes(3);

  poller.stop();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Structural equality detects head SHA changes
// ---------------------------------------------------------------------------

test('it emits a revision changed event when the head SHA changes', async () => {
  const storedRevision = buildRevision({ id: 'rev-1', headSHA: 'sha-old' });
  const providerRevision = buildRevision({ id: 'rev-1', headSHA: 'sha-new' });

  const { events, createPoller } = setupTest({
    providerRevisions: [providerRevision],
    storedRevisions: [storedRevision],
  });

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'revisionChanged',
    revisionID: 'rev-1',
  });
});

// ---------------------------------------------------------------------------
// New revision with null pipeline emits null for both pipeline statuses
// ---------------------------------------------------------------------------

test('it emits null pipeline statuses for a new revision with no pipeline', async () => {
  const revision = buildRevision({ id: 'rev-1', pipeline: null });

  const { events, createPoller } = setupTest({ providerRevisions: [revision] });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: null,
    revision,
    oldPipelineStatus: null,
    newPipelineStatus: null,
  });
});
