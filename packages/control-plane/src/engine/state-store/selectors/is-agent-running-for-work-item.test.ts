import { expect, test } from 'vitest';
import type { AgentRun, EngineState, ImplementorRun, ReviewerRun } from '../types.ts';
import { isAgentRunningForWorkItem } from './is-agent-running-for-work-item.ts';

function buildImplementorRun(
  overrides: Partial<ImplementorRun> & { sessionID: string },
): ImplementorRun {
  return {
    role: 'implementor',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feat/test',
    logFilePath: null,
    error: null,
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
    error: null,
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

test('it returns true when a running implementor run exists for the work item', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = setupTest([run]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(true);
});

test('it returns true when a requested reviewer run exists for the work item', () => {
  const run = buildReviewerRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'requested',
  });
  const state = setupTest([run]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(true);
});

test('it returns true when one run is completed and another is running for the same work item', () => {
  const completedRun = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'completed',
  });
  const runningRun = buildImplementorRun({
    sessionID: 'session-2',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = setupTest([completedRun, runningRun]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(true);
});

test('it returns false when all runs for the work item are in terminal status', () => {
  const completedRun = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'completed',
  });
  const failedRun = buildReviewerRun({
    sessionID: 'session-2',
    workItemID: 'wi-1',
    status: 'failed',
  });
  const state = setupTest([completedRun, failedRun]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(false);
});

test('it returns false when no agent runs exist', () => {
  const state = setupTest();

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(false);
});

test('it returns false when runs exist only for other work items', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-2',
    status: 'running',
  });
  const state = setupTest([run]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(false);
});

test('it ignores planner runs even if they are running', () => {
  const plannerRun: AgentRun = {
    role: 'planner',
    sessionID: 'session-1',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
  };
  const state = setupTest([plannerRun]);

  expect(isAgentRunningForWorkItem(state, 'wi-1')).toBe(false);
});
