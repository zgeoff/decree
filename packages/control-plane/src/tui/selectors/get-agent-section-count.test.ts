import { expect, test } from 'vitest';
import type { EngineState, ImplementorRun, ReviewerRun } from '../../engine/state-store/types.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { getAgentSectionCount } from './get-agent-section-count.ts';

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
  expect(getAgentSectionCount(state)).toBe(0);
});

test('it counts work items in the agents section', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'in-progress' }),
    buildWorkItem({ id: 'wi-2', status: 'review' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  expect(getAgentSectionCount(state)).toBe(2);
});

test('it does not count work items in the action section', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'pending' }),
    buildWorkItem({ id: 'wi-2', status: 'in-progress' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  expect(getAgentSectionCount(state)).toBe(1);
});

test('it does not count closed work items', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'in-progress' }),
    buildWorkItem({ id: 'wi-2', status: 'closed' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  expect(getAgentSectionCount(state)).toBe(1);
});

test('it counts work items with active implementor runs in the agents section', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const run: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  // Active implementor run overrides to implementing -> agents section
  expect(getAgentSectionCount(state)).toBe(1);
});

test('it counts work items with active reviewer runs in the agents section', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const run: ReviewerRun = {
    role: 'reviewer',
    sessionID: 'sess-1',
    status: 'running',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  expect(getAgentSectionCount(state)).toBe(1);
});
