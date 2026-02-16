import { expect, test } from 'vitest';
import type { AgentRun, EngineState, ImplementorRun, PlannerRun, ReviewerRun } from '../types.ts';
import { getActiveAgentRun } from './get-active-agent-run.ts';

function buildImplementorRun(
  overrides: Partial<ImplementorRun> & { sessionID: string },
): ImplementorRun {
  return {
    role: 'implementor',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feat/test',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildReviewerRun(overrides: Partial<ReviewerRun> & { sessionID: string }): ReviewerRun {
  return {
    role: 'reviewer',
    status: 'running',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildPlannerRun(overrides: Partial<PlannerRun> & { sessionID: string }): PlannerRun {
  return {
    role: 'planner',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setupTest(agentRuns: AgentRun[] = []): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(agentRuns.map((r) => [r.sessionID, r])),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it returns a running implementor run for the given work item', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = setupTest([run]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toStrictEqual(run);
});

test('it returns a requested reviewer run for the given work item', () => {
  const run = buildReviewerRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'requested',
  });
  const state = setupTest([run]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toStrictEqual(run);
});

test('it returns null when no active runs exist for the work item', () => {
  const completedRun = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'completed',
  });
  const state = setupTest([completedRun]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toBeNull();
});

test('it does not scan planner runs', () => {
  const plannerRun = buildPlannerRun({ sessionID: 'session-1', status: 'running' });
  const state = setupTest([plannerRun]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toBeNull();
});

test('it returns null when no agent runs exist', () => {
  const state = setupTest();

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toBeNull();
});

test('it ignores runs for other work items', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-2',
    status: 'running',
  });
  const state = setupTest([run]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toBeNull();
});

test('it returns null for failed and timed-out runs', () => {
  const failed = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'failed',
  });
  const timedOut = buildReviewerRun({
    sessionID: 'session-2',
    workItemID: 'wi-1',
    status: 'timed-out',
  });
  const state = setupTest([failed, timedOut]);

  const result = getActiveAgentRun(state, 'wi-1');

  expect(result).toBeNull();
});
