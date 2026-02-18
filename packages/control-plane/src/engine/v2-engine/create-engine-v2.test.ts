import invariant from 'tiny-invariant';
import { expect, test, vi } from 'vitest';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { CommandExecutor } from '../command-executor/types.ts';
import type { EventQueue } from '../event-queue/types.ts';
import type { Handler } from '../handlers/types.ts';
import type { RevisionPoller, SpecPollerV2, WorkItemPoller } from '../pollers/types.ts';
import type {
  AgentRole,
  EngineCommand,
  EngineEvent,
  WorkItemChanged,
} from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';
import type { Engine, EngineConfig } from './types.ts';

// --- Mock modules ---

// Mock all component factories so we inject test doubles rather than real implementations
vi.mock('../state-store/create-engine-store.ts', () => ({
  createEngineStore: vi.fn(),
}));

vi.mock('../event-queue/create-event-queue.ts', () => ({
  createEventQueue: vi.fn(),
}));

vi.mock('../state-store/apply-state-update.ts', () => ({
  applyStateUpdate: vi.fn(),
}));

vi.mock('../handlers/create-handlers.ts', () => ({
  createHandlers: vi.fn(),
}));

vi.mock('../command-executor/create-command-executor.ts', () => ({
  createCommandExecutor: vi.fn(),
}));

vi.mock('../pollers/create-work-item-poller.ts', () => ({
  createWorkItemPoller: vi.fn(),
}));

vi.mock('../pollers/create-revision-poller.ts', () => ({
  createRevisionPoller: vi.fn(),
}));

vi.mock('../pollers/create-spec-poller-v2.ts', () => ({
  createSpecPollerV2: vi.fn(),
}));

vi.mock('./build-review-history-fetcher.ts', () => ({
  buildReviewHistoryFetcher: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('./default-policy.ts', () => ({
  defaultPolicy: vi.fn().mockReturnValue({ allowed: true, reason: null }),
}));

// Import the mocked factories so we can configure them per test
import { createCommandExecutor } from '../command-executor/create-command-executor.ts';
import { createEventQueue } from '../event-queue/create-event-queue.ts';
import { createHandlers } from '../handlers/create-handlers.ts';
import { createRevisionPoller } from '../pollers/create-revision-poller.ts';
import { createSpecPollerV2 } from '../pollers/create-spec-poller-v2.ts';
import { createWorkItemPoller } from '../pollers/create-work-item-poller.ts';
import { applyStateUpdate } from '../state-store/apply-state-update.ts';
import { createEngineStore } from '../state-store/create-engine-store.ts';
import { createEngineV2 } from './create-engine-v2.ts';
import { defaultPolicy } from './default-policy.ts';

// --- Test helpers ---

interface MockComponents {
  store: MockStore;
  queue: MockQueue;
  executor: MockExecutor;
  handlers: Handler[];
  workItemPoller: MockPoller;
  revisionPoller: MockPoller;
  specPoller: MockPoller;
  runtimeAdapters: Record<AgentRole, MockRuntimeAdapter>;
}

interface MockStore {
  getState: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface MockQueue {
  enqueue: ReturnType<typeof vi.fn>;
  dequeue: ReturnType<typeof vi.fn>;
  isEmpty: ReturnType<typeof vi.fn>;
  size: ReturnType<typeof vi.fn>;
  setRejecting: ReturnType<typeof vi.fn>;
}

interface MockExecutor {
  execute: ReturnType<typeof vi.fn>;
}

interface MockPoller {
  poll: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface MockRuntimeAdapter {
  startAgent: ReturnType<typeof vi.fn>;
  cancelAgent: ReturnType<typeof vi.fn>;
}

function buildEmptyState(): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

function buildMockProvider(): EngineConfig['provider'] {
  return {
    workItemReader: {
      listWorkItems: vi.fn().mockResolvedValue([]),
      getWorkItem: vi.fn().mockResolvedValue(null),
      getWorkItemBody: vi.fn().mockResolvedValue('work item body'),
    },
    workItemWriter: {
      transitionStatus: vi.fn().mockResolvedValue(undefined),
      createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-new' }),
      updateWorkItem: vi.fn().mockResolvedValue(undefined),
    },
    revisionReader: {
      listRevisions: vi.fn().mockResolvedValue([]),
      getRevision: vi.fn().mockResolvedValue(null),
      getRevisionFiles: vi
        .fn()
        .mockResolvedValue([{ path: 'src/foo.ts', status: 'modified', patch: null }]),
    },
    revisionWriter: {
      createFromPatch: vi.fn().mockResolvedValue({ id: 'rev-new' }),
      updateBody: vi.fn().mockResolvedValue(undefined),
      postReview: vi.fn().mockResolvedValue('review-1'),
      updateReview: vi.fn().mockResolvedValue(undefined),
      postComment: vi.fn().mockResolvedValue(undefined),
    },
    specReader: {
      listSpecs: vi.fn().mockResolvedValue([]),
      getDefaultBranchSHA: vi.fn().mockResolvedValue('sha-main'),
    },
  };
}

function buildMockRuntimeAdapter(): MockRuntimeAdapter {
  return {
    startAgent: vi.fn().mockResolvedValue({
      output: emptyAsyncIterable(),
      result: new Promise(() => {
        // never resolves — tests control lifecycle manually
      }),
      logFilePath: null,
    }),
    cancelAgent: vi.fn(),
  };
}

async function* emptyAsyncIterable(): AsyncIterable<string> {
  // intentionally empty
}

interface SetupTestResult {
  engine: Engine;
  config: EngineConfig;
  mocks: MockComponents;
}

function setupTest(configOverrides?: Partial<EngineConfig>): SetupTestResult {
  const mockStore = buildMockStore();
  const mockQueue = buildMockQueue();
  const mockExecutor: MockExecutor = { execute: vi.fn().mockResolvedValue([]) };
  const mockHandlers: Handler[] = [];
  const mockWorkItemPoller = buildMockPoller();
  const mockRevisionPoller = buildMockPoller();
  const mockSpecPoller = buildMockPoller();
  const mockRuntimeAdapters: Record<AgentRole, MockRuntimeAdapter> = {
    planner: buildMockRuntimeAdapter(),
    implementor: buildMockRuntimeAdapter(),
    reviewer: buildMockRuntimeAdapter(),
  };

  vi.mocked(createEngineStore).mockReturnValue(
    mockStore as unknown as ReturnType<typeof createEngineStore>,
  );
  vi.mocked(createEventQueue).mockReturnValue(mockQueue as unknown as EventQueue);
  vi.mocked(createCommandExecutor).mockReturnValue(mockExecutor as unknown as CommandExecutor);
  vi.mocked(createHandlers).mockReturnValue(mockHandlers);
  vi.mocked(createWorkItemPoller).mockReturnValue(mockWorkItemPoller as unknown as WorkItemPoller);
  vi.mocked(createRevisionPoller).mockReturnValue(mockRevisionPoller as unknown as RevisionPoller);
  vi.mocked(createSpecPollerV2).mockReturnValue(mockSpecPoller as unknown as SpecPollerV2);

  const provider = buildMockProvider();

  const config: EngineConfig = {
    provider,
    createRuntimeAdapters: vi.fn().mockReturnValue(mockRuntimeAdapters),
    ...configOverrides,
  };

  const engine = createEngineV2(config);

  return {
    engine,
    config,
    mocks: {
      store: mockStore,
      queue: mockQueue,
      executor: mockExecutor,
      handlers: mockHandlers,
      workItemPoller: mockWorkItemPoller,
      revisionPoller: mockRevisionPoller,
      specPoller: mockSpecPoller,
      runtimeAdapters: mockRuntimeAdapters,
    },
  };
}

function buildMockStore(): MockStore {
  const initialState = buildEmptyState();
  const listeners = new Set<(engineState: EngineState) => void>();
  return {
    getState: vi.fn().mockImplementation(() => initialState),
    setState: vi.fn().mockImplementation((partial: Partial<EngineState>) => {
      Object.assign(initialState, partial);
      for (const listener of listeners) {
        listener(initialState);
      }
    }),
    subscribe: vi.fn().mockImplementation((listener: (engineState: EngineState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    destroy: vi.fn(),
  };
}

function buildMockQueue(): MockQueue {
  const events: EngineEvent[] = [];
  let rejecting = false;
  let filter: ((eventType: EngineEvent['type']) => boolean) | undefined;

  return {
    enqueue: vi.fn().mockImplementation((event: EngineEvent) => {
      if (rejecting) {
        const allowed = filter?.(event.type);
        if (!allowed) {
          throw new Error('Event queue is rejecting new events (shutdown in progress)');
        }
      }
      events.push(event);
    }),
    dequeue: vi.fn().mockImplementation(() => events.shift()),
    isEmpty: vi.fn().mockImplementation(() => events.length === 0),
    size: vi.fn().mockImplementation(() => events.length),
    setRejecting: vi
      .fn()
      .mockImplementation(
        (newRejecting: boolean, newFilter?: (eventType: EngineEvent['type']) => boolean) => {
          rejecting = newRejecting;
          filter = newFilter;
        },
      ),
  };
}

function buildMockPoller(): MockPoller {
  return {
    poll: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

// =============================================================================
// Configuration
// =============================================================================

test('it throws when provider is missing workItemReader', () => {
  const provider = buildMockProvider();
  // @ts-expect-error — deliberately removing required field for test
  provider.workItemReader = undefined;

  expect(() =>
    createEngineV2({
      provider,
      createRuntimeAdapters: vi.fn().mockReturnValue({
        planner: buildMockRuntimeAdapter(),
        implementor: buildMockRuntimeAdapter(),
        reviewer: buildMockRuntimeAdapter(),
      }),
    }),
  ).toThrow('EngineConfig.provider.workItemReader is required');
});

test('it throws when provider is missing workItemWriter', () => {
  const provider = buildMockProvider();
  // @ts-expect-error — deliberately removing required field for test
  provider.workItemWriter = undefined;

  expect(() =>
    createEngineV2({
      provider,
      createRuntimeAdapters: vi.fn().mockReturnValue({
        planner: buildMockRuntimeAdapter(),
        implementor: buildMockRuntimeAdapter(),
        reviewer: buildMockRuntimeAdapter(),
      }),
    }),
  ).toThrow('EngineConfig.provider.workItemWriter is required');
});

test('it throws when provider is missing revisionReader', () => {
  const provider = buildMockProvider();
  // @ts-expect-error — deliberately removing required field for test
  provider.revisionReader = undefined;

  expect(() =>
    createEngineV2({
      provider,
      createRuntimeAdapters: vi.fn().mockReturnValue({
        planner: buildMockRuntimeAdapter(),
        implementor: buildMockRuntimeAdapter(),
        reviewer: buildMockRuntimeAdapter(),
      }),
    }),
  ).toThrow('EngineConfig.provider.revisionReader is required');
});

test('it throws when provider is missing revisionWriter', () => {
  const provider = buildMockProvider();
  // @ts-expect-error — deliberately removing required field for test
  provider.revisionWriter = undefined;

  expect(() =>
    createEngineV2({
      provider,
      createRuntimeAdapters: vi.fn().mockReturnValue({
        planner: buildMockRuntimeAdapter(),
        implementor: buildMockRuntimeAdapter(),
        reviewer: buildMockRuntimeAdapter(),
      }),
    }),
  ).toThrow('EngineConfig.provider.revisionWriter is required');
});

test('it throws when provider is missing specReader', () => {
  const provider = buildMockProvider();
  // @ts-expect-error — deliberately removing required field for test
  provider.specReader = undefined;

  expect(() =>
    createEngineV2({
      provider,
      createRuntimeAdapters: vi.fn().mockReturnValue({
        planner: buildMockRuntimeAdapter(),
        implementor: buildMockRuntimeAdapter(),
        reviewer: buildMockRuntimeAdapter(),
      }),
    }),
  ).toThrow('EngineConfig.provider.specReader is required');
});

test('it throws when createRuntimeAdapters is missing', () => {
  const provider = buildMockProvider();

  expect(() =>
    createEngineV2({
      provider,
      // @ts-expect-error — deliberately removing required field for test
      createRuntimeAdapters: undefined,
    }),
  ).toThrow('EngineConfig.createRuntimeAdapters is required');
});

test('it passes runtime adapter deps with store getState and provider readers', () => {
  const { config, mocks } = setupTest();

  expect(config.createRuntimeAdapters).toHaveBeenCalledWith(
    expect.objectContaining({
      workItemReader: config.provider.workItemReader,
      revisionReader: config.provider.revisionReader,
      getState: mocks.store.getState,
    }),
  );
});

test('it threads provider readers to pollers and writers to command executor', () => {
  const { config } = setupTest();

  // Work item poller receives reader
  expect(vi.mocked(createWorkItemPoller)).toHaveBeenCalledWith(
    expect.objectContaining({
      reader: config.provider.workItemReader,
    }),
  );

  // Revision poller receives reader
  expect(vi.mocked(createRevisionPoller)).toHaveBeenCalledWith(
    expect.objectContaining({
      reader: config.provider.revisionReader,
    }),
  );

  // Spec poller receives reader
  expect(vi.mocked(createSpecPollerV2)).toHaveBeenCalledWith(
    expect.objectContaining({
      reader: config.provider.specReader,
    }),
  );

  // Command executor receives writers (not readers)
  expect(vi.mocked(createCommandExecutor)).toHaveBeenCalledWith(
    expect.objectContaining({
      workItemWriter: config.provider.workItemWriter,
      revisionWriter: config.provider.revisionWriter,
    }),
  );

  // Verify executor does NOT receive readers
  const executorCall = vi.mocked(createCommandExecutor).mock.lastCall;
  invariant(executorCall, 'createCommandExecutor must have been called');
  const executorDeps = executorCall[0];
  expect(executorDeps).not.toHaveProperty('workItemReader');
  expect(executorDeps).not.toHaveProperty('revisionReader');
  expect(executorDeps).not.toHaveProperty('specReader');
});

test('it uses the default policy when none is provided', () => {
  setupTest();

  expect(vi.mocked(createCommandExecutor)).toHaveBeenCalledWith(
    expect.objectContaining({
      policy: defaultPolicy,
    }),
  );
});

test('it uses a custom policy when provided', () => {
  const customPolicy = vi.fn().mockReturnValue({ allowed: true, reason: null });
  setupTest({ policy: customPolicy });

  expect(vi.mocked(createCommandExecutor)).toHaveBeenCalledWith(
    expect.objectContaining({
      policy: customPolicy,
    }),
  );
});

// =============================================================================
// Wiring
// =============================================================================

test('it exposes the zustand store instance for use-store binding', () => {
  const { engine, mocks } = setupTest();

  expect(engine.store).toBe(mocks.store);
});

test('it delegates getWorkItemBody to provider without caching', async () => {
  const { engine, config } = setupTest();

  const result = await engine.getWorkItemBody('wi-42');

  expect(config.provider.workItemReader.getWorkItemBody).toHaveBeenCalledWith('wi-42');
  expect(result).toBe('work item body');
});

test('it delegates getRevisionFiles to provider without caching', async () => {
  const { engine, config } = setupTest();

  const result = await engine.getRevisionFiles('rev-7');

  expect(config.provider.revisionReader.getRevisionFiles).toHaveBeenCalledWith('rev-7');
  expect(result).toStrictEqual([{ path: 'src/foo.ts', status: 'modified', patch: null }]);
});

// =============================================================================
// Processing Loop
// =============================================================================

test('it processes the first event fully before dequeuing the second', async () => {
  const { engine, mocks } = setupTest();

  const processingOrder: string[] = [];
  const event1 = buildWorkItemChangedUpsert({ workItemID: 'wi-1' });
  const event2 = buildWorkItemChangedUpsert({ workItemID: 'wi-2' });

  vi.mocked(applyStateUpdate).mockImplementation((_store, event) => {
    if ('workItemID' in event) {
      processingOrder.push(`update:${(event as WorkItemChanged).workItemID}`);
    }
  });

  // Add a handler that returns one command per event so executor gets called
  const dummyCommand: EngineCommand = {
    command: 'createWorkItem',
    title: 'T',
    body: 'B',
    labels: [],
    blockedBy: [],
  };
  const handler: Handler = vi.fn().mockReturnValue([dummyCommand]);
  mocks.handlers.push(handler);

  // Pre-load two events in the queue, then make it empty after both are consumed
  let dequeueCount = 0;
  mocks.queue.dequeue
    .mockImplementationOnce(() => {
      dequeueCount += 1;
      return event1;
    })
    .mockImplementationOnce(() => {
      dequeueCount += 1;
      return event2;
    })
    .mockImplementation(() => undefined);

  // Track executor calls
  mocks.executor.execute.mockImplementation(async () => {
    processingOrder.push(`execute:${dequeueCount}`);
    return [];
  });

  await engine.start();

  // Wait for processing loop to consume both events
  await vi.waitFor(() => {
    expect(dequeueCount).toBeGreaterThanOrEqual(2);
  });

  await engine.stop();

  // Verify sequential processing: event1's update and execution before event2's
  expect(processingOrder[0]).toBe('update:wi-1');
  expect(processingOrder[1]).toBe('execute:1');
  expect(processingOrder[2]).toBe('update:wi-2');
  expect(processingOrder[3]).toBe('execute:2');
});

test('it enqueues result events from command execution for subsequent cycles', async () => {
  const { engine, mocks } = setupTest();

  const event1 = buildWorkItemChangedUpsert({ workItemID: 'wi-1' });
  const resultEvent: EngineEvent = {
    type: 'commandRejected',
    command: { command: 'createWorkItem', title: '', body: '', labels: [], blockedBy: [] },
    reason: 'test rejection',
  };

  const handler: Handler = vi
    .fn()
    .mockReturnValueOnce([
      { command: 'createWorkItem', title: 'Test', body: 'Body', labels: [], blockedBy: [] },
    ])
    .mockReturnValue([]);

  mocks.handlers.push(handler);

  // Executor returns a result event for the first command
  mocks.executor.execute.mockResolvedValueOnce([resultEvent]).mockResolvedValue([]);

  // Queue: first dequeue returns event1, subsequent dequeues return from the actual queue
  let firstDequeue = true;
  const internalEvents: EngineEvent[] = [];
  mocks.queue.dequeue.mockImplementation(() => {
    if (firstDequeue) {
      firstDequeue = false;
      return event1;
    }
    return internalEvents.shift();
  });
  mocks.queue.isEmpty.mockImplementation(() => internalEvents.length === 0);
  mocks.queue.enqueue.mockImplementation((event: EngineEvent) => {
    internalEvents.push(event);
  });

  await engine.start();

  // Wait for the result event to be enqueued
  await vi.waitFor(() => {
    expect(mocks.queue.enqueue).toHaveBeenCalledWith(resultEvent);
  });

  await engine.stop();
});

test('it passes the same state snapshot to all commands from one event', async () => {
  const { engine, mocks } = setupTest();

  const event1 = buildWorkItemChangedUpsert({ workItemID: 'wi-1' });

  const command1: EngineCommand = {
    command: 'createWorkItem',
    title: 'T1',
    body: 'B1',
    labels: [],
    blockedBy: [],
  };
  const command2: EngineCommand = {
    command: 'createWorkItem',
    title: 'T2',
    body: 'B2',
    labels: [],
    blockedBy: [],
  };

  const handler: Handler = vi.fn().mockReturnValueOnce([command1, command2]).mockReturnValue([]);
  mocks.handlers.push(handler);

  const snapshotsPassedToExecute: EngineState[] = [];
  mocks.executor.execute.mockImplementation(
    async (_cmd: EngineCommand, engineState: EngineState) => {
      snapshotsPassedToExecute.push(engineState);
      return [];
    },
  );

  // Return event1 on first dequeue, then undefined
  mocks.queue.dequeue.mockReturnValueOnce(event1).mockReturnValue(undefined);

  await engine.start();

  await vi.waitFor(() => {
    expect(snapshotsPassedToExecute.length).toBe(2);
  });

  await engine.stop();

  // Both commands received the exact same snapshot reference
  expect(snapshotsPassedToExecute[0]).toBe(snapshotsPassedToExecute[1]);
});

test('it processes a user requested implementor run through the full pipeline', async () => {
  const { engine, mocks } = setupTest();

  const userEvent: EngineEvent = {
    type: 'userRequestedImplementorRun',
    workItemID: 'wi-1',
  };

  const handler: Handler = vi
    .fn()
    .mockReturnValueOnce([{ command: 'requestImplementorRun', workItemID: 'wi-1' }])
    .mockReturnValue([]);
  mocks.handlers.push(handler);
  mocks.executor.execute.mockResolvedValue([]);

  mocks.queue.dequeue.mockReturnValueOnce(userEvent).mockReturnValue(undefined);

  await engine.start();

  await vi.waitFor(() => {
    expect(vi.mocked(applyStateUpdate)).toHaveBeenCalledWith(mocks.store, userEvent);
  });

  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalledWith(userEvent, expect.anything());
  });

  await vi.waitFor(() => {
    expect(mocks.executor.execute).toHaveBeenCalledWith(
      { command: 'requestImplementorRun', workItemID: 'wi-1' },
      expect.anything(),
    );
  });

  await engine.stop();
});

// =============================================================================
// Startup
// =============================================================================

test('it awaits all three poller first cycles before start resolves', async () => {
  const { engine, mocks } = setupTest();

  const pollOrder: string[] = [];
  let wiResolved = false;
  let revResolved = false;
  let specResolved = false;

  mocks.workItemPoller.poll.mockImplementation(async () => {
    wiResolved = true;
    pollOrder.push('workItem');
  });
  mocks.revisionPoller.poll.mockImplementation(async () => {
    revResolved = true;
    pollOrder.push('revision');
  });
  mocks.specPoller.poll.mockImplementation(async () => {
    specResolved = true;
    pollOrder.push('spec');
  });

  await engine.start();

  // All three pollers completed their first cycle
  expect(wiResolved).toBe(true);
  expect(revResolved).toBe(true);
  expect(specResolved).toBe(true);
  expect(pollOrder).toHaveLength(3);

  await engine.stop();
});

test('it provides populated state when getState is called after start resolves', async () => {
  const { engine, mocks } = setupTest();

  const populatedState = buildEmptyState();
  populatedState.workItems.set('wi-1', {
    id: 'wi-1',
    title: 'Test',
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-01-01T00:00:00Z',
    linkedRevision: null,
  });

  mocks.store.getState.mockReturnValue(populatedState);

  await engine.start();

  const currentState = engine.getState();
  expect(currentState.workItems.size).toBe(1);
  expect(currentState.workItems.get('wi-1')).toMatchObject({ id: 'wi-1', title: 'Test' });

  await engine.stop();
});

test('it handles recovery through normal event processing without a separate phase', async () => {
  const { engine, mocks } = setupTest();

  // Simulate: first poll detects an in-progress work item with no active agent run
  const inProgressEvent = buildWorkItemChangedUpsert({
    workItemID: 'wi-orphan',
    workItem: {
      id: 'wi-orphan',
      title: 'Orphaned work item',
      status: 'in-progress',
      priority: null,
      complexity: null,
      blockedBy: [],
      createdAt: '2026-01-01T00:00:00Z',
      linkedRevision: null,
    },
    newStatus: 'in-progress',
  });

  // The work item poller enqueues events during poll()
  mocks.workItemPoller.poll.mockImplementation(async () => {
    engine.enqueue(inProgressEvent);
  });

  // A handler (handleOrphanedWorkItem) would emit a transition command
  const transitionCommand: EngineCommand = {
    command: 'transitionWorkItemStatus',
    workItemID: 'wi-orphan',
    newStatus: 'pending',
  };

  const handler: Handler = vi.fn().mockImplementation((event: EngineEvent) => {
    if (event.type === 'workItemChanged' && (event as WorkItemChanged).workItemID === 'wi-orphan') {
      return [transitionCommand];
    }
    return [];
  });
  mocks.handlers.push(handler);
  mocks.executor.execute.mockResolvedValue([]);

  await engine.start();

  // Wait for the event to be processed
  await vi.waitFor(() => {
    expect(vi.mocked(applyStateUpdate)).toHaveBeenCalledWith(mocks.store, inProgressEvent);
  });

  await vi.waitFor(() => {
    expect(mocks.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'transitionWorkItemStatus',
        workItemID: 'wi-orphan',
        newStatus: 'pending',
      }),
      expect.anything(),
    );
  });

  await engine.stop();
});

// =============================================================================
// Shutdown
// =============================================================================

test('it cancels all active agent runs before stopping pollers', async () => {
  const { engine, mocks } = setupTest();

  // Set up active agent runs in state
  const stateWithRuns = buildEmptyState();
  stateWithRuns.agentRuns.set('session-impl-1', {
    role: 'implementor',
    sessionID: 'session-impl-1',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });
  stateWithRuns.agentRuns.set('session-plan-1', {
    role: 'planner',
    sessionID: 'session-plan-1',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });

  mocks.store.getState.mockReturnValue(stateWithRuns);

  const callOrder: string[] = [];
  mocks.runtimeAdapters.implementor.cancelAgent.mockImplementation(() => {
    callOrder.push('cancelAgent:implementor');
  });
  mocks.runtimeAdapters.planner.cancelAgent.mockImplementation(() => {
    callOrder.push('cancelAgent:planner');
  });
  mocks.workItemPoller.stop.mockImplementation(() => {
    callOrder.push('stopPoller:workItem');
  });
  mocks.revisionPoller.stop.mockImplementation(() => {
    callOrder.push('stopPoller:revision');
  });
  mocks.specPoller.stop.mockImplementation(() => {
    callOrder.push('stopPoller:spec');
  });

  // Make agent runs transition to terminal state immediately so drain completes
  mocks.store.getState.mockReturnValueOnce(stateWithRuns).mockReturnValue({
    ...stateWithRuns,
    agentRuns: new Map(), // cleared after cancellation
  });

  await engine.start();
  await engine.stop();

  // Verify cancel happened before poller stop
  const cancelIndices = callOrder
    .filter((c) => c.startsWith('cancelAgent'))
    .map((c) => callOrder.indexOf(c));
  const pollerStopIndices = callOrder
    .filter((c) => c.startsWith('stopPoller'))
    .map((c) => callOrder.indexOf(c));

  for (const cancelIdx of cancelIndices) {
    for (const pollerIdx of pollerStopIndices) {
      expect(cancelIdx).toBeLessThan(pollerIdx);
    }
  }
});

test('it rejects new events after shutdown begins', async () => {
  const { engine, mocks } = setupTest();

  await engine.start();

  // Start shutdown in the background
  const stopPromise = engine.stop();

  // Verify setRejecting was called
  expect(mocks.queue.setRejecting).toHaveBeenCalledWith(true, expect.any(Function));

  await stopPromise;
});

test('it abandons remaining monitors when shutdown timeout is reached', async () => {
  const { engine, mocks } = setupTest({ shutdownTimeout: 0.05 }); // 50ms timeout

  // Active agent run that never transitions to terminal
  const stateWithRun = buildEmptyState();
  stateWithRun.agentRuns.set('session-stuck', {
    role: 'implementor',
    sessionID: 'session-stuck',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });

  // Always return the same state with the stuck agent run
  mocks.store.getState.mockReturnValue(stateWithRun);

  await engine.start();

  // stop() should resolve even though the agent never reaches terminal state
  const stopStart = Date.now();
  await engine.stop();
  const stopDuration = Date.now() - stopStart;

  // Should complete reasonably quickly (within a few seconds, not hang)
  expect(stopDuration).toBeLessThan(5000);

  // Pollers should still be stopped
  expect(mocks.workItemPoller.stop).toHaveBeenCalled();
  expect(mocks.revisionPoller.stop).toHaveBeenCalled();
  expect(mocks.specPoller.stop).toHaveBeenCalled();
});

test('it processes terminal events from agent monitors during shutdown drain', async () => {
  const { engine, mocks } = setupTest();

  const stateWithRun = buildEmptyState();
  stateWithRun.agentRuns.set('session-1', {
    role: 'implementor',
    sessionID: 'session-1',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });

  // First getState returns active run, second returns completed (after cancellation)
  const completedState = buildEmptyState();
  completedState.agentRuns.set('session-1', {
    role: 'implementor',
    sessionID: 'session-1',
    status: 'completed',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });

  mocks.store.getState
    .mockReturnValueOnce(stateWithRun) // during cancellation check
    .mockReturnValue(completedState); // after cancellation

  const terminalEvent: EngineEvent = {
    type: 'implementorCompleted',
    workItemID: 'wi-1',
    sessionID: 'session-1',
    branchName: 'feature/wi-1',
    result: { role: 'implementor', outcome: 'completed', patch: null, summary: 'Done' },
    logFilePath: null,
  };

  // Terminal event is in the queue for draining
  let drainDequeueCall = 0;
  mocks.queue.dequeue.mockImplementation(() => {
    // During drain phase, return the terminal event once
    drainDequeueCall += 1;
    if (drainDequeueCall === 1) {
      return terminalEvent;
    }
    return;
  });
  mocks.queue.isEmpty.mockImplementation(() => drainDequeueCall > 0);

  await engine.start();
  await engine.stop();

  // The terminal event should have been processed (applyStateUpdate called with it)
  expect(vi.mocked(applyStateUpdate)).toHaveBeenCalledWith(mocks.store, terminalEvent);
});

// =============================================================================
// Agent Run Handles
// =============================================================================

test('it passes handle registration callbacks to the command executor', () => {
  setupTest();

  const executorCall = vi.mocked(createCommandExecutor).mock.lastCall;
  invariant(executorCall, 'createCommandExecutor must have been called');
  const executorDeps = executorCall[0];

  expect(executorDeps).toHaveProperty('onHandleRegistered');
  expect(executorDeps).toHaveProperty('onHandleRemoved');
  expect(typeof executorDeps.onHandleRegistered).toBe('function');
  expect(typeof executorDeps.onHandleRemoved).toBe('function');
});

test('it returns the output stream via getAgentStream when a handle is registered through the callback', () => {
  const { engine } = setupTest();

  const executorCall = vi.mocked(createCommandExecutor).mock.lastCall;
  invariant(executorCall, 'createCommandExecutor must have been called');
  const executorDeps = executorCall[0];

  const mockOutput = emptyAsyncIterable();
  const mockHandle = {
    output: mockOutput,
    result: new Promise<never>(() => {
      // never resolves — tests control lifecycle manually
    }),
    logFilePath: null,
  };

  // Simulate the executor registering a handle (as startAgentAsync would)
  invariant(executorDeps.onHandleRegistered, 'onHandleRegistered must be defined');
  executorDeps.onHandleRegistered('session-active', mockHandle);

  const stream = engine.getAgentStream('session-active');
  expect(stream).toBe(mockOutput);
});

test('it returns null from getAgentStream after a handle is removed through the callback', () => {
  const { engine } = setupTest();

  const executorCall = vi.mocked(createCommandExecutor).mock.lastCall;
  invariant(executorCall, 'createCommandExecutor must have been called');
  const executorDeps = executorCall[0];

  const mockOutput = emptyAsyncIterable();
  const mockHandle = {
    output: mockOutput,
    result: new Promise<never>(() => {
      // never resolves — tests control lifecycle manually
    }),
    logFilePath: null,
  };

  // Register then remove
  invariant(executorDeps.onHandleRegistered, 'onHandleRegistered must be defined');
  invariant(executorDeps.onHandleRemoved, 'onHandleRemoved must be defined');
  executorDeps.onHandleRegistered('session-done', mockHandle);
  executorDeps.onHandleRemoved('session-done');

  const stream = engine.getAgentStream('session-done');
  expect(stream).toBeNull();
});

test('it returns null from getAgentStream when no handle exists', () => {
  const { engine } = setupTest();

  const stream = engine.getAgentStream('nonexistent-session');
  expect(stream).toBeNull();
});

test('it returns null from getAgentStream for a session in requested state', () => {
  const { engine, mocks } = setupTest();

  // Set up a session in requested state — handle is only registered after startAgent resolves
  const stateWithRequestedSession = buildEmptyState();
  stateWithRequestedSession.agentRuns.set('session-requested', {
    role: 'implementor',
    sessionID: 'session-requested',
    status: 'requested',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  });
  mocks.store.getState.mockReturnValue(stateWithRequestedSession);

  // Even though the session exists in state, getAgentStream returns null because
  // no handle has been registered yet (startAgent hasn't resolved)
  const stream = engine.getAgentStream('session-requested');
  expect(stream).toBeNull();
});

// =============================================================================
// Refresh
// =============================================================================

test('it triggers an immediate poll cycle on all pollers when refresh is called', () => {
  const { engine, mocks } = setupTest();

  engine.refresh();

  expect(mocks.workItemPoller.poll).toHaveBeenCalled();
  expect(mocks.revisionPoller.poll).toHaveBeenCalled();
  expect(mocks.specPoller.poll).toHaveBeenCalled();
});

// =============================================================================
// Subscribe
// =============================================================================

test('it delegates subscribe to the zustand store', () => {
  const { engine, mocks } = setupTest();

  const listener = vi.fn();
  const unsub = engine.subscribe(listener);

  expect(mocks.store.subscribe).toHaveBeenCalledWith(listener);
  expect(typeof unsub).toBe('function');
});
