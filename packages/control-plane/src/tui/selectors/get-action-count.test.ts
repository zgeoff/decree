import { expect, test } from 'vitest';
import type { EngineState, ImplementorRun } from '../../engine/state-store/types.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { getActionCount } from './get-action-count.ts';

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
  expect(getActionCount(state)).toBe(0);
});

test('it counts work items in the action section', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'pending' }),
    buildWorkItem({ id: 'wi-2', status: 'ready' }),
    buildWorkItem({ id: 'wi-3', status: 'approved' }),
    buildWorkItem({ id: 'wi-4', status: 'blocked' }),
    buildWorkItem({ id: 'wi-5', status: 'needs-refinement' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  expect(getActionCount(state)).toBe(5);
});

test('it does not count work items in the agents section', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'pending' }),
    buildWorkItem({ id: 'wi-2', status: 'in-progress' }),
    buildWorkItem({ id: 'wi-3', status: 'review' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  // pending is action, in-progress is agents, review is agents
  expect(getActionCount(state)).toBe(1);
});

test('it does not count closed work items', () => {
  const items = [
    buildWorkItem({ id: 'wi-1', status: 'pending' }),
    buildWorkItem({ id: 'wi-2', status: 'closed' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
  });

  expect(getActionCount(state)).toBe(1);
});

test('it counts failed work items in the action section', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const failedRun: ImplementorRun = {
    role: 'implementor',
    sessionID: 'sess-1',
    status: 'failed',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', failedRun]]),
  });

  // failed display status maps to action section
  expect(getActionCount(state)).toBe(1);
});
