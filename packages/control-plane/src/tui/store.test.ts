import { expect, test, vi } from 'vitest';
import type { RevisionFile } from '../engine/github-provider/types.ts';
import type { UserRequestedImplementorRun } from '../engine/state-store/types.ts';
import {
  appendStreamLines,
  type CreateTUIStoreConfig,
  clearStreamBuffer,
  consumeAgentStream,
  createTUIStore,
  type TUIEngine,
} from './store.ts';

// ---------------------------------------------------------------------------
// Mock engine factory
// ---------------------------------------------------------------------------

interface MockEngineResult {
  engine: TUIEngine;
  enqueuedEvents: UserRequestedImplementorRun[];
  stopCalls: number;
}

function createMockEngine(overrides?: Partial<TUIEngine>): MockEngineResult {
  const enqueuedEvents: UserRequestedImplementorRun[] = [];
  let stopCalls = 0;

  const engine: TUIEngine = {
    store: overrides?.store ?? {
      getState: () => ({
        workItems: new Map(),
        revisions: new Map(),
        specs: new Map(),
        agentRuns: new Map(),
        errors: [],
        lastPlannedSHAs: new Map(),
      }),
      subscribe: vi.fn(() => () => {
        // no-op unsubscribe
      }),
    },
    enqueue:
      overrides?.enqueue ??
      vi.fn((event: UserRequestedImplementorRun) => {
        enqueuedEvents.push(event);
      }),
    stop:
      overrides?.stop ??
      vi.fn(async () => {
        stopCalls += 1;
      }),
    getWorkItemBody: overrides?.getWorkItemBody ?? vi.fn(async () => 'mock body'),
    getRevisionFiles: overrides?.getRevisionFiles ?? vi.fn(async () => []),
    getAgentStream: overrides?.getAgentStream ?? vi.fn(() => null),
  };

  return {
    engine,
    get enqueuedEvents(): UserRequestedImplementorRun[] {
      return enqueuedEvents;
    },
    get stopCalls(): number {
      return stopCalls;
    },
  };
}

function setupTest(overrides?: Partial<TUIEngine>): {
  store: ReturnType<typeof createTUIStore>;
  engine: TUIEngine;
  enqueuedEvents: UserRequestedImplementorRun[];
} {
  const { engine, enqueuedEvents } = createMockEngine(overrides);
  const config: CreateTUIStoreConfig = { engine };
  const store = createTUIStore(config);
  return { store, engine, enqueuedEvents };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

test('it initializes with the correct default state shape', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.selectedWorkItem).toBeNull();
  expect(state.pinnedWorkItem).toBeNull();
  expect(state.focusedPane).toBe('workItemList');
  expect(state.shuttingDown).toBe(false);
  expect(state.streamBuffers).toStrictEqual(new Map());
  expect(state.detailCache).toStrictEqual(new Map());
});

test('it does not contain domain state like tasks or planner status', () => {
  const { store } = setupTest();
  const state = store.getState();
  const keys = Object.keys(state);

  expect(keys).not.toContain('tasks');
  expect(keys).not.toContain('plannerStatus');
});

// ---------------------------------------------------------------------------
// Action — selectWorkItem
// ---------------------------------------------------------------------------

test('it updates the selected work item', () => {
  const { store } = setupTest();

  store.getState().selectWorkItem('42');
  expect(store.getState().selectedWorkItem).toBe('42');
});

test('it replaces the previously selected work item', () => {
  const { store } = setupTest();

  store.getState().selectWorkItem('42');
  store.getState().selectWorkItem('99');
  expect(store.getState().selectedWorkItem).toBe('99');
});

// ---------------------------------------------------------------------------
// Action — pinWorkItem
// ---------------------------------------------------------------------------

test('it sets the pinned work item', () => {
  const { store } = setupTest();

  store.getState().pinWorkItem('42');
  expect(store.getState().pinnedWorkItem).toBe('42');
});

test('it triggers on-demand detail fetch when pinning a work item', () => {
  const getWorkItemBody = vi.fn(async () => 'fetched body');
  const getRevisionFiles = vi.fn(async (): Promise<RevisionFile[]> => []);
  const { store } = setupTest({ getWorkItemBody, getRevisionFiles });

  store.getState().pinWorkItem('42');

  expect(getWorkItemBody).toHaveBeenCalledWith('42');
  expect(getRevisionFiles).toHaveBeenCalledWith('42');
});

test('it clears stream buffers when the pinned work item changes', () => {
  const { store } = setupTest();

  // Set up initial stream buffer
  const streamBuffers = new Map([['sess-1', ['line1', 'line2']]]);
  store.setState({ streamBuffers });

  store.getState().pinWorkItem('42');

  expect(store.getState().streamBuffers).toStrictEqual(new Map());
});

test('it clears detail cache when the pinned work item changes', () => {
  const { store } = setupTest();

  // Set up initial detail cache
  const detailCache = new Map([
    ['old-item', { body: 'cached', revisionFiles: null, loading: false }],
  ]);
  store.setState({ detailCache });

  store.getState().pinWorkItem('42');

  // Cache should be empty (old item cleared) before new fetch completes
  const cacheAfter = store.getState().detailCache;
  expect(cacheAfter.has('old-item')).toBe(false);
});

test('it populates the detail cache when on-demand fetch completes', async () => {
  const getWorkItemBody = vi.fn(async () => 'fetched body');
  const getRevisionFiles = vi.fn(
    async (): Promise<RevisionFile[]> => [{ path: 'src/main.ts', status: 'modified', patch: null }],
  );
  const { store } = setupTest({ getWorkItemBody, getRevisionFiles });

  store.getState().pinWorkItem('42');

  await vi.waitFor(() => {
    const cached = store.getState().detailCache.get('42');
    expect(cached).toBeDefined();
    expect(cached?.loading).toBe(false);
  });

  const cached = store.getState().detailCache.get('42');
  expect(cached?.body).toBe('fetched body');
  expect(cached?.revisionFiles).toStrictEqual([
    { path: 'src/main.ts', status: 'modified', patch: null },
  ]);
});

test('it sets the detail cache to loading while fetch is in progress', () => {
  let resolveBody: (value: string) => void = () => {
    // default no-op, replaced by promise constructor
  };
  const bodyPromise = new Promise<string>((resolve) => {
    resolveBody = resolve;
  });
  const getWorkItemBody = vi.fn(() => bodyPromise);
  const getRevisionFiles = vi.fn(async (): Promise<RevisionFile[]> => []);
  const { store } = setupTest({ getWorkItemBody, getRevisionFiles });

  store.getState().pinWorkItem('42');

  const cached = store.getState().detailCache.get('42');
  expect(cached?.loading).toBe(true);

  // Clean up
  resolveBody('body');
});

test('it discards fetch results if pinned work item changed during fetch', async () => {
  let resolveFirstBody: (value: string) => void = () => {
    // default no-op, replaced by promise constructor
  };
  const firstBodyPromise = new Promise<string>((resolve) => {
    resolveFirstBody = resolve;
  });

  let callCount = 0;
  const getWorkItemBody = vi.fn((id: string) => {
    callCount += 1;
    if (callCount === 1) {
      // First call (for '42') — returns deferred promise
      return firstBodyPromise;
    }
    // Second call (for '99') — resolves immediately
    return Promise.resolve(`body for ${id}`);
  });
  const getRevisionFiles = vi.fn(async (): Promise<RevisionFile[]> => []);
  const { store } = setupTest({ getWorkItemBody, getRevisionFiles });

  store.getState().pinWorkItem('42');

  // Pin a different work item before fetch for '42' completes
  store.getState().pinWorkItem('99');

  // Wait for the second fetch to complete
  await vi.waitFor(() => {
    const cached = store.getState().detailCache.get('99');
    expect(cached?.loading).toBe(false);
  });

  // Now resolve the stale first fetch
  resolveFirstBody('stale body for 42');
  await new Promise((r) => setTimeout(r, 0));

  // The cache entry for '42' should not exist — cleared when pinning '99'
  expect(store.getState().detailCache.has('42')).toBe(false);

  // The cache for '99' should have its own body, not the stale one
  const cached99 = store.getState().detailCache.get('99');
  expect(cached99?.body).toBe('body for 99');
});

// ---------------------------------------------------------------------------
// Action — cycleFocus
// ---------------------------------------------------------------------------

test('it toggles focus from work item list to detail pane', () => {
  const { store } = setupTest();

  expect(store.getState().focusedPane).toBe('workItemList');

  store.getState().cycleFocus();
  expect(store.getState().focusedPane).toBe('detailPane');
});

test('it toggles focus from detail pane back to work item list', () => {
  const { store } = setupTest();

  store.getState().cycleFocus();
  store.getState().cycleFocus();
  expect(store.getState().focusedPane).toBe('workItemList');
});

// ---------------------------------------------------------------------------
// Action — dispatchImplementor
// ---------------------------------------------------------------------------

test('it enqueues a user-requested implementor run event', () => {
  const { store, enqueuedEvents } = setupTest();

  store.getState().dispatchImplementor('42');

  expect(enqueuedEvents).toStrictEqual([{ type: 'userRequestedImplementorRun', workItemID: '42' }]);
});

test('it calls engine enqueue with the correct event shape', () => {
  const enqueue = vi.fn();
  const { store } = setupTest({ enqueue });

  store.getState().dispatchImplementor('100');

  expect(enqueue).toHaveBeenCalledWith({
    type: 'userRequestedImplementorRun',
    workItemID: '100',
  });
});

test('it does not call engine send for dispatch', () => {
  const { store, engine } = setupTest();

  store.getState().dispatchImplementor('42');

  // Verify engine.enqueue was called (not engine.send which doesn't exist)
  expect(engine.enqueue).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Action — shutdown
// ---------------------------------------------------------------------------

test('it sets the shutting down flag when shutdown is called', () => {
  const { store } = setupTest();

  store.getState().shutdown();

  expect(store.getState().shuttingDown).toBe(true);
});

test('it calls engine stop when shutdown is called', () => {
  const { store, engine } = setupTest();

  store.getState().shutdown();

  expect(engine.stop).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Stream buffer helpers — appendStreamLines
// ---------------------------------------------------------------------------

test('it appends stream lines to the buffer keyed by session identifier', () => {
  const { store } = setupTest();

  appendStreamLines(store, 'sess-1', ['line1', 'line2']);

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer).toStrictEqual(['line1', 'line2']);
});

test('it appends additional lines to an existing buffer', () => {
  const { store } = setupTest();

  appendStreamLines(store, 'sess-1', ['line1']);
  appendStreamLines(store, 'sess-1', ['line2', 'line3']);

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer).toStrictEqual(['line1', 'line2', 'line3']);
});

test('it drops the oldest lines when the buffer exceeds the limit', () => {
  const { store } = setupTest();

  const lines: string[] = [];
  for (let i = 0; i < 10_001; i += 1) {
    lines.push(`line-${i}`);
  }

  appendStreamLines(store, 'sess-1', lines);

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer).toBeDefined();
  expect(buffer?.length).toBe(10_000);
  expect(buffer?.[0]).toBe('line-1');
  expect(buffer?.[buffer.length - 1]).toBe('line-10000');
});

test('it caps an existing buffer when new lines cause overflow', () => {
  const { store } = setupTest();

  // Fill buffer to 9999 lines
  const initialLines: string[] = [];
  for (let i = 0; i < 9999; i += 1) {
    initialLines.push(`initial-${i}`);
  }
  appendStreamLines(store, 'sess-1', initialLines);

  // Add 2 more lines, causing 1 line to overflow
  appendStreamLines(store, 'sess-1', ['extra-1', 'extra-2']);

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer?.length).toBe(10_000);
  expect(buffer?.[0]).toBe('initial-1');
  expect(buffer?.[buffer.length - 1]).toBe('extra-2');
});

test('it produces a new stream buffer collection reference when lines are appended', () => {
  const { store } = setupTest();

  const initialBuffers = store.getState().streamBuffers;
  appendStreamLines(store, 'sess-1', ['line1']);

  expect(store.getState().streamBuffers).not.toBe(initialBuffers);
});

// ---------------------------------------------------------------------------
// Stream buffer helpers — clearStreamBuffer
// ---------------------------------------------------------------------------

test('it removes a stream buffer entry by session identifier', () => {
  const { store } = setupTest();

  appendStreamLines(store, 'sess-1', ['line1']);
  expect(store.getState().streamBuffers.has('sess-1')).toBe(true);

  clearStreamBuffer(store, 'sess-1');
  expect(store.getState().streamBuffers.has('sess-1')).toBe(false);
});

test('it is a no-op when clearing a non-existent buffer', () => {
  const { store } = setupTest();

  const buffersBefore = store.getState().streamBuffers;
  clearStreamBuffer(store, 'non-existent');

  expect(store.getState().streamBuffers).toBe(buffersBefore);
});

// ---------------------------------------------------------------------------
// Stream consumption — consumeAgentStream
// ---------------------------------------------------------------------------

test('it consumes a stream and appends lines to the buffer', async () => {
  let resolveStream: () => void;
  const streamDone = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });

  async function* generate(): AsyncGenerator<string> {
    yield 'line1\nline2\n';
    resolveStream();
  }

  const getAgentStream = vi.fn(() => generate());
  const { store, engine } = setupTest({ getAgentStream });

  consumeAgentStream(store, engine, 'sess-1');

  await streamDone;
  await new Promise((r) => setTimeout(r, 0));

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer).toStrictEqual(['line1', 'line2']);
});

test('it does nothing when the engine returns null for a stream', () => {
  const getAgentStream = vi.fn(() => null);
  const { store, engine } = setupTest({ getAgentStream });

  consumeAgentStream(store, engine, 'sess-1');

  expect(store.getState().streamBuffers.has('sess-1')).toBe(false);
});

test('it caps the buffer at ten thousand lines during stream consumption', async () => {
  const chunks: string[] = [];
  for (let i = 0; i < 10_001; i += 1) {
    chunks.push(`chunk-${i}`);
  }

  let resolveStream: () => void;
  const streamPromise = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });

  async function* generateChunks(): AsyncGenerator<string> {
    for (const chunk of chunks) {
      yield chunk;
    }
    resolveStream();
  }

  const getAgentStream = vi.fn(() => generateChunks());
  const { store, engine } = setupTest({ getAgentStream });

  consumeAgentStream(store, engine, 'sess-1');

  await streamPromise;
  await new Promise((r) => setTimeout(r, 0));

  const buffer = store.getState().streamBuffers.get('sess-1');
  expect(buffer).toBeDefined();
  expect(buffer?.length).toBe(10_000);
  expect(buffer?.[0]).toBe('chunk-1');
  expect(buffer?.[buffer.length - 1]).toBe('chunk-10000');
});

// ---------------------------------------------------------------------------
// No domain state duplication
// ---------------------------------------------------------------------------

test('it does not store work items in the tui local state', () => {
  const { store } = setupTest();
  const state = store.getState();

  // The state should not have any domain collections
  expect('workItems' in state).toBe(false);
  expect('revisions' in state).toBe(false);
  expect('agentRuns' in state).toBe(false);
  expect('specs' in state).toBe(false);
});

// ---------------------------------------------------------------------------
// No engine.on() or engine.send()
// ---------------------------------------------------------------------------

test('it uses engine.enqueue not engine.send for mutations', () => {
  const enqueue = vi.fn();
  const { store } = setupTest({ enqueue });

  store.getState().dispatchImplementor('42');

  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'userRequestedImplementorRun' }),
  );
});

// ---------------------------------------------------------------------------
// Map immutability for Zustand change detection
// ---------------------------------------------------------------------------

test('it produces a new detail cache reference when a work item is pinned', () => {
  const { store } = setupTest();

  const initialCache = store.getState().detailCache;
  store.getState().pinWorkItem('42');

  expect(store.getState().detailCache).not.toBe(initialCache);
});

test('it produces a new stream buffers reference when buffers are cleared on pin', () => {
  const { store } = setupTest();

  appendStreamLines(store, 'sess-1', ['line1']);
  const initialBuffers = store.getState().streamBuffers;

  store.getState().pinWorkItem('42');

  expect(store.getState().streamBuffers).not.toBe(initialBuffers);
});
