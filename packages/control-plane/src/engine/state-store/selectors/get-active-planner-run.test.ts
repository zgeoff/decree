import { expect, test } from 'vitest';
import type { AgentRun, EngineState, PlannerRun } from '../types.ts';
import { getActivePlannerRun } from './get-active-planner-run.ts';

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

test('it returns a running planner run', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'running' });
  const state = setupTest([run]);

  const result = getActivePlannerRun(state);

  expect(result).toStrictEqual(run);
});

test('it returns a requested planner run', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'requested' });
  const state = setupTest([run]);

  const result = getActivePlannerRun(state);

  expect(result).toStrictEqual(run);
});

test('it returns null when the planner run is completed', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'completed' });
  const state = setupTest([run]);

  const result = getActivePlannerRun(state);

  expect(result).toBeNull();
});

test('it returns null when no planner runs exist', () => {
  const state = setupTest();

  const result = getActivePlannerRun(state);

  expect(result).toBeNull();
});

test('it ignores non-planner agent runs', () => {
  const implementorRun: AgentRun = {
    role: 'implementor',
    sessionID: 'session-1',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feat/test',
    logFilePath: null,
    startedAt: '2026-01-01T00:00:00Z',
  };
  const state = setupTest([implementorRun]);

  const result = getActivePlannerRun(state);

  expect(result).toBeNull();
});

test('it returns null for failed planner runs', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'failed' });
  const state = setupTest([run]);

  const result = getActivePlannerRun(state);

  expect(result).toBeNull();
});
