import { expect, test } from 'vitest';
import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  PlannerRun,
  ReviewerRun,
} from '../../engine/state-store/types.ts';
import { getRunningAgentCount } from './get-running-agent-count.ts';

function buildEngineState(overrides?: Partial<EngineState>): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
    ...overrides,
  };
}

test('it returns zero for empty state', () => {
  const state = buildEngineState();
  expect(getRunningAgentCount(state)).toBe(0);
});

test('it counts runs with requested status', () => {
  const run: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'requested',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['sess-1', run]]),
  });

  expect(getRunningAgentCount(state)).toBe(1);
});

test('it counts runs with running status', () => {
  const run: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['sess-1', run]]),
  });

  expect(getRunningAgentCount(state)).toBe(1);
});

test('it does not count runs with completed status', () => {
  const run: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'completed',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['sess-1', run]]),
  });

  expect(getRunningAgentCount(state)).toBe(0);
});

test('it does not count runs with failed status', () => {
  const run: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'failed',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['sess-1', run]]),
  });

  expect(getRunningAgentCount(state)).toBe(0);
});

test('it includes planner runs in the count', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'running',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  expect(getRunningAgentCount(state)).toBe(1);
});

test('it counts all running agents across all roles', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'running',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const implementorRun: ImplementorRun = {
    role: 'implementor',
    sessionID: 'impl-sess',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const reviewerRun: ReviewerRun = {
    role: 'reviewer',
    sessionID: 'rev-sess',
    status: 'requested',
    workItemID: 'wi-2',
    revisionID: 'rev-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const completedRun: ImplementorRun = {
    role: 'implementor',
    sessionID: 'completed-sess',
    status: 'completed',
    workItemID: 'wi-3',
    branchName: 'branch-3',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map<string, AgentRun>([
      ['planner-sess', plannerRun],
      ['impl-sess', implementorRun],
      ['rev-sess', reviewerRun],
      ['completed-sess', completedRun],
    ]),
  });

  // 3 running/requested, 1 completed (not counted)
  expect(getRunningAgentCount(state)).toBe(3);
});
