import { expect, test, vi } from 'vitest';
import { buildSpec } from '../../test-utils/build-spec.ts';
import type { Spec, SpecChanged } from '../state-store/types.ts';
import { createSpecPollerV2 } from './create-spec-poller-v2.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupTestState {
  workItems: Map<never, never>;
  revisions: Map<never, never>;
  specs: Map<string, Spec>;
  agentRuns: Map<never, never>;
  errors: never[];
  lastPlannedSHAs: Map<never, never>;
}

interface SetupTestResult {
  reader: { listSpecs: ReturnType<typeof vi.fn> };
  state: SetupTestState;
  events: SpecChanged[];
  enqueue: ReturnType<typeof vi.fn>;
  getDefaultBranchSHA: ReturnType<typeof vi.fn>;
  createPoller: () => ReturnType<typeof createSpecPollerV2>;
}

function setupTest(
  options: { providerSpecs?: Spec[]; storedSpecs?: Spec[] } = {},
): SetupTestResult {
  const reader = {
    listSpecs: vi.fn(),
  };

  const state: SetupTestState = {
    workItems: new Map<never, never>(),
    revisions: new Map<never, never>(),
    specs: new Map<string, Spec>(),
    agentRuns: new Map<never, never>(),
    errors: [] as never[],
    lastPlannedSHAs: new Map<never, never>(),
  };

  if (options.storedSpecs) {
    for (const spec of options.storedSpecs) {
      state.specs.set(spec.filePath, spec);
    }
  }

  reader.listSpecs.mockResolvedValue(options.providerSpecs ?? []);

  const events: SpecChanged[] = [];
  const enqueue = vi.fn((event: SpecChanged) => {
    events.push(event);
  });

  const getDefaultBranchSHA = vi.fn().mockResolvedValue('commit-sha-abc');

  function createPoller(): ReturnType<typeof createSpecPollerV2> {
    return createSpecPollerV2({
      reader,
      getState: () => state,
      enqueue,
      interval: 60,
      getDefaultBranchSHA,
    });
  }

  return { reader, state, events, enqueue, getDefaultBranchSHA, createPoller };
}

// ---------------------------------------------------------------------------
// First poll — store empty, all specs are additions
// ---------------------------------------------------------------------------

test('it emits added events for all specs when the store is empty', async () => {
  const specs = [
    buildSpec({
      filePath: 'docs/specs/engine.md',
      blobSHA: 'sha-1',
      frontmatterStatus: 'approved',
    }),
    buildSpec({ filePath: 'docs/specs/tui.md', blobSHA: 'sha-2', frontmatterStatus: 'draft' }),
  ];

  const { events, createPoller } = setupTest({ providerSpecs: specs });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(2);
  expect(events[0]).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
    changeType: 'added',
    commitSHA: 'commit-sha-abc',
  });
  expect(events[1]).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/tui.md',
    blobSHA: 'sha-2',
    frontmatterStatus: 'draft',
    changeType: 'added',
    commitSHA: 'commit-sha-abc',
  });
});

// ---------------------------------------------------------------------------
// Modified spec — blobSHA changed
// ---------------------------------------------------------------------------

test('it emits a modified event when a spec blob SHA changes', async () => {
  const storedSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'old-sha',
    frontmatterStatus: 'approved',
  });
  const providerSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'new-sha',
    frontmatterStatus: 'approved',
  });

  const { events, createPoller } = setupTest({
    providerSpecs: [providerSpec],
    storedSpecs: [storedSpec],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/engine.md',
    blobSHA: 'new-sha',
    frontmatterStatus: 'approved',
    changeType: 'modified',
    commitSHA: 'commit-sha-abc',
  });
});

// ---------------------------------------------------------------------------
// Modified spec — frontmatterStatus changed
// ---------------------------------------------------------------------------

test('it emits a modified event when a spec frontmatter status changes', async () => {
  const storedSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'draft',
  });
  const providerSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });

  const { events, createPoller } = setupTest({
    providerSpecs: [providerSpec],
    storedSpecs: [storedSpec],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
    changeType: 'modified',
    commitSHA: 'commit-sha-abc',
  });
});

// ---------------------------------------------------------------------------
// No changes — provider matches store exactly
// ---------------------------------------------------------------------------

test('it emits no events and skips commit SHA fetch when provider matches store', async () => {
  const spec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });

  const { events, getDefaultBranchSHA, createPoller } = setupTest({
    providerSpecs: [spec],
    storedSpecs: [spec],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
  expect(getDefaultBranchSHA).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Removed spec — present in store, absent from provider
// ---------------------------------------------------------------------------

test('it does not emit events for specs present in store but absent from provider', async () => {
  const storedSpec = buildSpec({ filePath: 'docs/specs/removed.md', blobSHA: 'sha-old' });
  const providerSpec = buildSpec({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-1' });

  const { events, createPoller } = setupTest({
    providerSpecs: [providerSpec],
    storedSpecs: [storedSpec, providerSpec],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Reader throws — poll cycle is skipped
// ---------------------------------------------------------------------------

test('it skips the poll cycle without emitting events when the reader throws', async () => {
  const { reader, events, createPoller } = setupTest();
  reader.listSpecs.mockRejectedValue(new Error('GitHub API rate limit exceeded'));

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Reader throws then recovers — next cycle proceeds normally
// ---------------------------------------------------------------------------

test('it proceeds normally on the next cycle after a reader failure', async () => {
  const spec = buildSpec({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-1' });
  const { reader, events, createPoller } = setupTest();

  const poller = createPoller();

  reader.listSpecs.mockRejectedValueOnce(new Error('transient failure'));
  await poller.poll();
  expect(events).toHaveLength(0);

  reader.listSpecs.mockResolvedValue([spec]);
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    changeType: 'added',
    filePath: 'docs/specs/engine.md',
  });
});

// ---------------------------------------------------------------------------
// getDefaultBranchSHA throws — poll cycle skipped
// ---------------------------------------------------------------------------

test('it skips the poll cycle when getDefaultBranchSHA throws after changes detected', async () => {
  const spec = buildSpec({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-1' });
  const { getDefaultBranchSHA, events, createPoller } = setupTest({ providerSpecs: [spec] });
  getDefaultBranchSHA.mockRejectedValue(new Error('ref fetch failed'));

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// getDefaultBranchSHA throws then recovers — re-detects same changes
// ---------------------------------------------------------------------------

test('it re-detects the same changes on the next cycle after a commit SHA failure', async () => {
  const spec = buildSpec({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-1' });
  const { getDefaultBranchSHA, events, createPoller } = setupTest({ providerSpecs: [spec] });

  getDefaultBranchSHA
    .mockRejectedValueOnce(new Error('ref fetch failed'))
    .mockResolvedValueOnce('commit-sha-retry');

  const poller = createPoller();

  await poller.poll();
  expect(events).toHaveLength(0);

  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    filePath: 'docs/specs/engine.md',
    changeType: 'added',
    commitSHA: 'commit-sha-retry',
  });
});

// ---------------------------------------------------------------------------
// Mixed batch — added and modified specs in a single cycle
// ---------------------------------------------------------------------------

test('it correctly distinguishes added and modified specs in a single cycle', async () => {
  const storedSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'old-sha',
    frontmatterStatus: 'draft',
  });
  const modifiedSpec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'new-sha',
    frontmatterStatus: 'approved',
  });
  const addedSpec = buildSpec({
    filePath: 'docs/specs/tui.md',
    blobSHA: 'sha-2',
    frontmatterStatus: 'draft',
  });

  const { events, createPoller } = setupTest({
    providerSpecs: [modifiedSpec, addedSpec],
    storedSpecs: [storedSpec],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(2);

  const engineEvent = events.find((e) => e.filePath === 'docs/specs/engine.md');
  expect(engineEvent).toMatchObject({
    changeType: 'modified',
    blobSHA: 'new-sha',
    frontmatterStatus: 'approved',
  });

  const tuiEvent = events.find((e) => e.filePath === 'docs/specs/tui.md');
  expect(tuiEvent).toMatchObject({
    changeType: 'added',
    blobSHA: 'sha-2',
  });
});

// ---------------------------------------------------------------------------
// Multiple specs unchanged, one added
// ---------------------------------------------------------------------------

test('it only emits events for specs that differ from the store', async () => {
  const unchanged = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });
  const added = buildSpec({
    filePath: 'docs/specs/tui.md',
    blobSHA: 'sha-2',
    frontmatterStatus: 'draft',
  });

  const { events, createPoller } = setupTest({
    providerSpecs: [unchanged, added],
    storedSpecs: [unchanged],
  });
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    filePath: 'docs/specs/tui.md',
    changeType: 'added',
  });
});

// ---------------------------------------------------------------------------
// Commit SHA is included in all events of a cycle
// ---------------------------------------------------------------------------

test('it includes the commit SHA from getDefaultBranchSHA in all emitted events', async () => {
  const specs = [
    buildSpec({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }),
    buildSpec({ filePath: 'docs/specs/b.md', blobSHA: 'sha-b' }),
    buildSpec({ filePath: 'docs/specs/c.md', blobSHA: 'sha-c' }),
  ];

  const { getDefaultBranchSHA, events, createPoller } = setupTest({ providerSpecs: specs });
  getDefaultBranchSHA.mockResolvedValue('commit-sha-xyz');

  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(3);
  for (const event of events) {
    expect(event.commitSHA).toBe('commit-sha-xyz');
  }
});

// ---------------------------------------------------------------------------
// stop() — basic functionality
// ---------------------------------------------------------------------------

test('it exposes poll and stop methods on the returned interface', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  expect(typeof poller.poll).toBe('function');
  expect(typeof poller.stop).toBe('function');

  poller.stop();
});

// ---------------------------------------------------------------------------
// poll returns void
// ---------------------------------------------------------------------------

test('it returns void from poll', async () => {
  const { createPoller } = setupTest();
  const poller = createPoller();
  const result = await poller.poll();
  poller.stop();

  expect(result).toBeUndefined();
});

// ---------------------------------------------------------------------------
// stop is safe to call before any poll
// ---------------------------------------------------------------------------

test('it is safe to call stop before any poll has been invoked', () => {
  const { createPoller } = setupTest();
  const poller = createPoller();

  poller.stop();
});

// ---------------------------------------------------------------------------
// Empty provider and empty store
// ---------------------------------------------------------------------------

test('it emits no events when both the provider and store are empty', async () => {
  const { events, createPoller } = setupTest();
  const poller = createPoller();
  await poller.poll();
  poller.stop();

  expect(events).toHaveLength(0);
});
