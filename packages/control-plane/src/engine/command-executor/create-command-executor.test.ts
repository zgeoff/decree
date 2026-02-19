import invariant from 'tiny-invariant';
import { expect, test, vi } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { createMockEnqueue } from '../../test-utils/create-mock-enqueue.ts';
import { createMockPolicy } from '../../test-utils/create-mock-policy.ts';
import {
  createMockRuntimeAdapter,
  type MockRuntimeAdapterResult,
} from '../../test-utils/create-mock-runtime-adapter.ts';
import type { AgentResult, EngineCommand } from '../state-store/domain-type-stubs.ts';
import type { AgentRun, EngineState, PlannerRun } from '../state-store/types.ts';
import { createCommandExecutor } from './create-command-executor.ts';
import type { CommandExecutorDeps } from './types.ts';

function getFirstHandle(adapter: MockRuntimeAdapterResult): MockRuntimeAdapterResult['handles'][0] {
  const handle = adapter.handles[0];
  invariant(handle, 'expected at least one handle to have been created');
  return handle;
}

function buildPlannerRun(overrides: Partial<PlannerRun> & { sessionID: string }): PlannerRun {
  return {
    role: 'planner',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setupState(config?: {
  agentRuns?: AgentRun[];
  workItems?: [string, ReturnType<typeof buildWorkItem>][];
  revisions?: [string, ReturnType<typeof buildRevision>][];
}): EngineState {
  return {
    workItems: new Map(config?.workItems ?? []),
    revisions: new Map(config?.revisions ?? []),
    specs: new Map(),
    agentRuns: new Map((config?.agentRuns ?? []).map((r) => [r.sessionID, r])),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

function setupTest(config?: {
  policyRejectedCommands?: Map<string, string>;
  state?: EngineState;
  plannerStartError?: Error;
  implementorStartError?: Error;
  reviewerStartError?: Error;
}): {
  deps: CommandExecutorDeps;
  state: EngineState;
  enqueueSpy: ReturnType<typeof createMockEnqueue>;
  plannerAdapter: MockRuntimeAdapterResult;
  implementorAdapter: MockRuntimeAdapterResult;
  reviewerAdapter: MockRuntimeAdapterResult;
} {
  const plannerAdapter = createMockRuntimeAdapter(
    config?.plannerStartError ? { startAgentError: config.plannerStartError } : undefined,
  );
  const implementorAdapter = createMockRuntimeAdapter(
    config?.implementorStartError ? { startAgentError: config.implementorStartError } : undefined,
  );
  const reviewerAdapter = createMockRuntimeAdapter(
    config?.reviewerStartError ? { startAgentError: config.reviewerStartError } : undefined,
  );
  const enqueueSpy = createMockEnqueue();
  const policy = createMockPolicy(
    config?.policyRejectedCommands
      ? { rejectedCommands: config.policyRejectedCommands }
      : undefined,
  );
  const state = config?.state ?? setupState();

  const deps: CommandExecutorDeps = {
    workItemWriter: {
      transitionStatus: vi.fn().mockResolvedValue(undefined),
      createWorkItem: vi.fn().mockResolvedValue(buildWorkItem({ id: 'created-wi' })),
      updateWorkItem: vi.fn().mockResolvedValue(undefined),
    },
    revisionWriter: {
      createFromPatch: vi
        .fn()
        .mockResolvedValue(buildRevision({ id: 'created-rev', workItemID: 'wi-1' })),
      updateBody: vi.fn().mockResolvedValue(undefined),
      postReview: vi.fn().mockResolvedValue('new-review-id'),
      updateReview: vi.fn().mockResolvedValue(undefined),
      postComment: vi.fn().mockResolvedValue(undefined),
    },
    runtimeAdapters: {
      planner: plannerAdapter.adapter,
      implementor: implementorAdapter.adapter,
      reviewer: reviewerAdapter.adapter,
    },
    policy,
    getState: vi.fn().mockReturnValue(state),
    enqueue: enqueueSpy.enqueue,
  };

  return { deps, state, enqueueSpy, plannerAdapter, implementorAdapter, reviewerAdapter };
}

// --- Policy rejects command ---

test('it returns command rejected when policy disallows the command', async () => {
  const rejectedCommands = new Map([['createWorkItem', 'manual only']]);
  const { deps, state } = setupTest({ policyRejectedCommands: rejectedCommands });
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = {
    command: 'createWorkItem',
    title: 'Test',
    body: 'Body',
    labels: [],
    blockedBy: [],
  };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'commandRejected',
    command,
    reason: 'manual only',
  });
  expect(deps.workItemWriter.createWorkItem).not.toHaveBeenCalled();
});

// --- Concurrency guard rejects RequestPlannerRun ---

test('it returns command rejected when concurrency guard rejects planner run', async () => {
  const run = buildPlannerRun({ sessionID: 'existing', status: 'running' });
  const state = setupState({ agentRuns: [run] });
  const { deps } = setupTest({ state });
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'commandRejected',
    reason: 'planner already running',
  });
  expect(deps.policy).not.toHaveBeenCalled();
});

// --- Provider throws during command execution ---

test('it returns command failed when provider throws during execution', async () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const state = setupState({ workItems: [['wi-1', workItem]] });
  const { deps } = setupTest({ state });
  vi.mocked(deps.workItemWriter.transitionStatus).mockRejectedValue(new Error('API timeout'));
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = {
    command: 'transitionWorkItemStatus',
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'commandFailed',
    command,
    error: 'API timeout',
  });
});

// --- startAgent throws during startAgentAsync ---

test('it enqueues a failed event when start agent throws during provisioning', async () => {
  const { deps, state, enqueueSpy } = setupTest({
    plannerStartError: new Error('sandbox allocation failed'),
  });
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'plannerRequested' });

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'plannerFailed')).toBe(true);
  });

  expect(enqueueSpy.events).toHaveLength(1);
  expect(enqueueSpy.events[0]).toMatchObject({
    type: 'plannerFailed',
    error: 'sandbox allocation failed',
    logFilePath: null,
  });
});

// --- startAgent resolves, handle.result resolves ---

test('it enqueues started then completed when agent run succeeds', async () => {
  const { deps, state, enqueueSpy, plannerAdapter } = setupTest();
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };
  const plannerResult: AgentResult = { role: 'planner', create: [], close: [], update: [] };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'plannerRequested' });

  getFirstHandle(plannerAdapter).resolveResult(plannerResult);

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'plannerCompleted')).toBe(true);
  });

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toMatchObject({ type: 'plannerStarted' });
  expect(enqueueSpy.events[1]).toMatchObject({
    type: 'plannerCompleted',
    result: plannerResult,
  });
});

// --- startAgent resolves, handle.result rejects ---

test('it enqueues started then failed when agent result rejects', async () => {
  const { deps, state, enqueueSpy, plannerAdapter } = setupTest();
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'plannerRequested' });

  getFirstHandle(plannerAdapter).rejectResult(new Error('agent crashed'));

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'plannerFailed')).toBe(true);
  });

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toMatchObject({ type: 'plannerStarted' });
  expect(enqueueSpy.events[1]).toMatchObject({
    type: 'plannerFailed',
    error: 'agent crashed',
  });
});

// --- startAgent itself rejects (no preceding started) ---

test('it enqueues failed without started when start agent itself rejects', async () => {
  const { deps, state, enqueueSpy } = setupTest({
    plannerStartError: new Error('provisioning failure'),
  });
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  await executor.execute(command, state);

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'plannerFailed')).toBe(true);
  });

  const startedEvents = enqueueSpy.events.filter((e) => e.type === 'plannerStarted');
  expect(startedEvents).toHaveLength(0);
  expect(enqueueSpy.events).toHaveLength(1);
  expect(enqueueSpy.events[0]).toMatchObject({
    type: 'plannerFailed',
    error: 'provisioning failure',
  });
});

// --- RequestPlannerRun end-to-end ---

test('it returns planner requested synchronously and enqueues planner started after agent starts', async () => {
  const { deps, state, enqueueSpy, plannerAdapter } = setupTest();
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'plannerRequested',
    specPaths: ['docs/specs/a.md'],
  });
  expect(events[0]).toMatchObject({ sessionID: expect.any(String) });

  const plannerResult: AgentResult = { role: 'planner', create: [], close: [], update: [] };
  getFirstHandle(plannerAdapter).resolveResult(plannerResult);

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'plannerStarted')).toBe(true);
  });
});

// --- RequestImplementorRun end-to-end ---

test('it returns implementor requested with branch name matching decree format', async () => {
  const { deps, state, enqueueSpy, implementorAdapter } = setupTest();
  const executor = createCommandExecutor(deps);
  const command: EngineCommand = { command: 'requestImplementorRun', workItemID: 'wi-42' };

  const events = await executor.execute(command, state);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'implementorRequested',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  });
  expect(events[0]).toMatchObject({ sessionID: expect.any(String) });

  const implResult: AgentResult = {
    role: 'implementor',
    outcome: 'completed',
    patch: 'diff',
    summary: 'Done',
  };
  getFirstHandle(implementorAdapter).resolveResult(implResult);

  await vi.waitFor(() => {
    expect(enqueueSpy.events.some((e) => e.type === 'implementorCompleted')).toBe(true);
  });

  expect(enqueueSpy.events[0]).toMatchObject({ type: 'implementorStarted' });
  expect(enqueueSpy.events[1]).toMatchObject({
    type: 'implementorCompleted',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  });
});
