import invariant from 'tiny-invariant';
import { expect, test, vi } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { createMockEnqueue } from '../../test-utils/create-mock-enqueue.ts';
import {
  createMockRuntimeAdapter,
  type MockRuntimeAdapterResult,
} from '../../test-utils/create-mock-runtime-adapter.ts';
import type { AgentResult } from '../state-store/domain-type-stubs.ts';
import { startAgentAsync } from './start-agent-async.ts';
import type { AgentRunHandle, AgentStartParams, CommandExecutorDeps } from './types.ts';

function getFirstHandle(adapter: MockRuntimeAdapterResult): MockRuntimeAdapterResult['handles'][0] {
  const handle = adapter.handles[0];
  invariant(handle, 'expected at least one handle to have been created');
  return handle;
}

function setupTest(config?: { startAgentError?: Error }): {
  deps: CommandExecutorDeps;
  agentHandles: Map<string, AgentRunHandle>;
  plannerAdapter: MockRuntimeAdapterResult;
  implementorAdapter: MockRuntimeAdapterResult;
  reviewerAdapter: MockRuntimeAdapterResult;
  enqueueSpy: ReturnType<typeof createMockEnqueue>;
} {
  const plannerAdapter = createMockRuntimeAdapter(
    config?.startAgentError ? { startAgentError: config.startAgentError } : undefined,
  );
  const implementorAdapter = createMockRuntimeAdapter(
    config?.startAgentError ? { startAgentError: config.startAgentError } : undefined,
  );
  const reviewerAdapter = createMockRuntimeAdapter(
    config?.startAgentError ? { startAgentError: config.startAgentError } : undefined,
  );
  const enqueueSpy = createMockEnqueue();

  const deps: CommandExecutorDeps = {
    workItemWriter: {
      transitionStatus: vi.fn().mockResolvedValue(undefined),
      createWorkItem: vi.fn().mockResolvedValue(buildWorkItem({ id: 'wi-1' })),
      updateWorkItem: vi.fn().mockResolvedValue(undefined),
    },
    revisionWriter: {
      createFromPatch: vi.fn().mockResolvedValue(undefined),
      updateBody: vi.fn().mockResolvedValue(undefined),
      postReview: vi.fn().mockResolvedValue('review-id'),
      updateReview: vi.fn().mockResolvedValue(undefined),
      postComment: vi.fn().mockResolvedValue(undefined),
    },
    runtimeAdapters: {
      planner: plannerAdapter.adapter,
      implementor: implementorAdapter.adapter,
      reviewer: reviewerAdapter.adapter,
    },
    policy: vi.fn().mockReturnValue({ allowed: true, reason: null }),
    getState: vi.fn().mockReturnValue({
      workItems: new Map(),
      revisions: new Map(),
      specs: new Map(),
      agentRuns: new Map(),
      errors: [],
      lastPlannedSHAs: new Map(),
    }),
    enqueue: enqueueSpy.enqueue,
  };

  const agentHandles = new Map<string, AgentRunHandle>();

  return { deps, agentHandles, plannerAdapter, implementorAdapter, reviewerAdapter, enqueueSpy };
}

// --- Planner: startAgent resolves, handle.result resolves ---

test('it enqueues planner started then planner completed when agent resolves successfully', async () => {
  const { deps, agentHandles, plannerAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };
  const plannerResult: AgentResult = { role: 'planner', create: [], close: [], update: [] };

  const promise = startAgentAsync('planner', 'session-1', params, { deps, agentHandles });
  getFirstHandle(plannerAdapter).resolveResult(plannerResult);
  await promise;

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toStrictEqual({
    type: 'plannerStarted',
    sessionID: 'session-1',
    logFilePath: '/logs/agent.log',
  });
  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'plannerCompleted',
    sessionID: 'session-1',
    specPaths: ['docs/specs/a.md'],
    result: plannerResult,
    logFilePath: '/logs/agent.log',
  });
});

// --- Planner: startAgent resolves, handle.result rejects ---

test('it enqueues planner started then planner failed when agent result rejects', async () => {
  const { deps, agentHandles, plannerAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };

  const promise = startAgentAsync('planner', 'session-1', params, { deps, agentHandles });
  getFirstHandle(plannerAdapter).rejectResult(new Error('agent crashed'));
  await promise;

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toMatchObject({
    type: 'plannerStarted',
    sessionID: 'session-1',
  });
  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'plannerFailed',
    sessionID: 'session-1',
    specPaths: ['docs/specs/a.md'],
    reason: 'error',
    error: 'agent crashed',
    logFilePath: '/logs/agent.log',
  });
});

// --- Planner: startAgent itself rejects ---

test('it enqueues planner failed without started when start agent itself rejects', async () => {
  const { deps, agentHandles, enqueueSpy } = setupTest({
    startAgentError: new Error('provisioning failure'),
  });
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };

  await startAgentAsync('planner', 'session-1', params, { deps, agentHandles });

  expect(enqueueSpy.events).toHaveLength(1);
  expect(enqueueSpy.events[0]).toStrictEqual({
    type: 'plannerFailed',
    sessionID: 'session-1',
    specPaths: ['docs/specs/a.md'],
    reason: 'error',
    error: 'provisioning failure',
    logFilePath: null,
  });
});

// --- Implementor: startAgent resolves, handle.result resolves ---

test('it enqueues implementor started then implementor completed with work item and branch fields', async () => {
  const { deps, agentHandles, implementorAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = {
    role: 'implementor',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  };
  const implResult: AgentResult = {
    role: 'implementor',
    outcome: 'completed',
    patch: 'diff',
    summary: 'Done',
  };

  const promise = startAgentAsync('implementor', 'session-2', params, { deps, agentHandles });
  getFirstHandle(implementorAdapter).resolveResult(implResult);
  await promise;

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toStrictEqual({
    type: 'implementorStarted',
    sessionID: 'session-2',
    logFilePath: '/logs/agent.log',
  });
  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'implementorCompleted',
    sessionID: 'session-2',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
    result: implResult,
    logFilePath: '/logs/agent.log',
  });
});

// --- Implementor: startAgent resolves, handle.result rejects ---

test('it enqueues implementor started then implementor failed when agent result rejects', async () => {
  const { deps, agentHandles, implementorAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = {
    role: 'implementor',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  };

  const promise = startAgentAsync('implementor', 'session-2', params, { deps, agentHandles });
  getFirstHandle(implementorAdapter).rejectResult(new Error('build failed'));
  await promise;

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toMatchObject({
    type: 'implementorStarted',
    sessionID: 'session-2',
  });
  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'implementorFailed',
    sessionID: 'session-2',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
    reason: 'error',
    error: 'build failed',
    logFilePath: '/logs/agent.log',
  });
});

// --- Reviewer: startAgent resolves, handle.result resolves ---

test('it enqueues reviewer started then reviewer completed with revision fields', async () => {
  const { deps, agentHandles, reviewerAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = {
    role: 'reviewer',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
  };
  const reviewerResult: AgentResult = {
    role: 'reviewer',
    review: { verdict: 'approve', summary: 'LGTM', comments: [] },
  };

  const promise = startAgentAsync('reviewer', 'session-3', params, { deps, agentHandles });
  getFirstHandle(reviewerAdapter).resolveResult(reviewerResult);
  await promise;

  expect(enqueueSpy.events).toHaveLength(2);
  expect(enqueueSpy.events[0]).toStrictEqual({
    type: 'reviewerStarted',
    sessionID: 'session-3',
    logFilePath: '/logs/agent.log',
  });
  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'reviewerCompleted',
    sessionID: 'session-3',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
    logFilePath: '/logs/agent.log',
  });
});

// --- Handle retention: added on start, removed on terminal ---

test('it retains the agent handle while running and removes it when the run completes', async () => {
  const { deps, agentHandles, plannerAdapter } = setupTest();
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };
  const plannerResult: AgentResult = { role: 'planner', create: [], close: [], update: [] };

  const promise = startAgentAsync('planner', 'session-1', params, { deps, agentHandles });

  await vi.waitFor(() => {
    expect(agentHandles.has('session-1')).toBe(true);
  });

  getFirstHandle(plannerAdapter).resolveResult(plannerResult);
  await promise;

  expect(agentHandles.has('session-1')).toBe(false);
});

test('it removes the agent handle when the run fails', async () => {
  const { deps, agentHandles, plannerAdapter } = setupTest();
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };

  const promise = startAgentAsync('planner', 'session-1', params, { deps, agentHandles });

  await vi.waitFor(() => {
    expect(agentHandles.has('session-1')).toBe(true);
  });

  getFirstHandle(plannerAdapter).rejectResult(new Error('crash'));
  await promise;

  expect(agentHandles.has('session-1')).toBe(false);
});

test('it does not add a handle when start agent itself rejects', async () => {
  const { deps, agentHandles } = setupTest({
    startAgentError: new Error('provisioning failure'),
  });
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };

  await startAgentAsync('planner', 'session-1', params, { deps, agentHandles });

  expect(agentHandles.has('session-1')).toBe(false);
});

// --- Failure reason derivation: timeout ---

test('it emits timeout reason when the abort signal was aborted with timeout', async () => {
  const { deps, agentHandles, plannerAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = { role: 'planner', specPaths: ['docs/specs/a.md'] };

  const promise = startAgentAsync('planner', 'session-1', params, { deps, agentHandles });
  const handle = getFirstHandle(plannerAdapter);
  handle.abortController.abort('timeout');
  handle.rejectResult(new Error('agent timed out'));
  await promise;

  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'plannerFailed',
    sessionID: 'session-1',
    specPaths: ['docs/specs/a.md'],
    reason: 'timeout',
    error: 'agent timed out',
    logFilePath: '/logs/agent.log',
  });
});

// --- Failure reason derivation: cancelled ---

test('it emits cancelled reason when the abort signal was aborted with cancelled', async () => {
  const { deps, agentHandles, implementorAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = {
    role: 'implementor',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  };

  const promise = startAgentAsync('implementor', 'session-2', params, { deps, agentHandles });
  const handle = getFirstHandle(implementorAdapter);
  handle.abortController.abort('cancelled');
  handle.rejectResult(new Error('agent was cancelled'));
  await promise;

  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'implementorFailed',
    sessionID: 'session-2',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
    reason: 'cancelled',
    error: 'agent was cancelled',
    logFilePath: '/logs/agent.log',
  });
});

// --- Failure reason derivation: error (default) ---

test('it emits error reason when the abort signal was not aborted', async () => {
  const { deps, agentHandles, reviewerAdapter, enqueueSpy } = setupTest();
  const params: AgentStartParams = {
    role: 'reviewer',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
  };

  const promise = startAgentAsync('reviewer', 'session-3', params, { deps, agentHandles });
  getFirstHandle(reviewerAdapter).rejectResult(new Error('validation failed'));
  await promise;

  expect(enqueueSpy.events[1]).toStrictEqual({
    type: 'reviewerFailed',
    sessionID: 'session-3',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    reason: 'error',
    error: 'validation failed',
    logFilePath: '/logs/agent.log',
  });
});
