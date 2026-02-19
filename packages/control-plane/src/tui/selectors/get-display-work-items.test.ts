import { expect, test } from 'vitest';
import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  ReviewerRun,
} from '../../engine/state-store/types.ts';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { getDisplayWorkItems } from './get-display-work-items.ts';

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

function buildImplementorRun(
  overrides: Partial<ImplementorRun> & { sessionID: string },
): ImplementorRun {
  return {
    role: 'implementor',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'branch-1',
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
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
    startedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

test('it returns an empty array for empty state', () => {
  const state = buildEngineState();
  const result = getDisplayWorkItems(state);
  expect(result).toStrictEqual([]);
});

test('it excludes closed work items', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'closed' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toStrictEqual([]);
});

test('it derives display status from work item status when no runs exist', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'dispatch',
    section: 'action',
  });
});

test('it overrides display status with implementing when an active implementor run exists', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const run = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'implementing',
    section: 'agents',
  });
});

test('it overrides display status with reviewing when an active reviewer run exists', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const run = buildReviewerRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'reviewing',
    section: 'agents',
  });
});

test('it derives failed display status when latest run has failed status', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const run = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'failed',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'failed',
    section: 'action',
  });
});

test('it derives failed display status when latest run has timed-out status', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review' });
  const run = buildReviewerRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'timed-out',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'failed',
    section: 'action',
  });
});

test('it does not trigger failure override for cancelled runs', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const run = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'cancelled',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['sess-1', run]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'dispatch',
    section: 'action',
  });
});

test('it clears failure when a new active run exists after a failed run', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'in-progress' });
  const failedRun = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'failed',
    startedAt: '2026-02-01T00:00:00Z',
  });
  const newRun = buildImplementorRun({
    sessionID: 'sess-2',
    workItemID: 'wi-1',
    status: 'requested',
    startedAt: '2026-02-01T01:00:00Z',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([
      ['sess-1', failedRun],
      ['sess-2', newRun],
    ]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    displayStatus: 'implementing',
    section: 'agents',
  });
});

test('it looks up linked revision from state', () => {
  const revision = buildRevision({ id: 'rev-1' });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'approved', linkedRevision: 'rev-1' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    revisions: new Map([['rev-1', revision]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.linkedRevision).toStrictEqual(revision);
});

test('it returns null linked revision when work item has no linked revision', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.linkedRevision).toBeNull();
});

test('it returns null linked revision when revision is not in the store', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending', linkedRevision: 'rev-missing' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.linkedRevision).toBeNull();
});

test('it finds the latest run by started-at for the work item', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const olderRun = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'completed',
    startedAt: '2026-02-01T00:00:00Z',
  });
  const newerRun = buildImplementorRun({
    sessionID: 'sess-2',
    workItemID: 'wi-1',
    status: 'completed',
    startedAt: '2026-02-01T01:00:00Z',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([
      ['sess-1', olderRun],
      ['sess-2', newerRun],
    ]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.latestRun).toStrictEqual(newerRun);
});

test('it returns null latest run when no runs exist for the work item', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.latestRun).toBeNull();
});

test('it excludes planner runs from latest run and dispatch count', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const plannerRun: AgentRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'running',
    specPaths: ['spec.md'],
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
  };
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.latestRun).toBeNull();
  expect(result[0]?.dispatchCount).toBe(0);
});

test('it computes dispatch count as total implementor and reviewer runs for the work item', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const run1 = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'completed',
    startedAt: '2026-02-01T00:00:00Z',
  });
  const run2 = buildImplementorRun({
    sessionID: 'sess-2',
    workItemID: 'wi-1',
    status: 'failed',
    startedAt: '2026-02-01T01:00:00Z',
  });
  const run3 = buildReviewerRun({
    sessionID: 'sess-3',
    workItemID: 'wi-1',
    status: 'completed',
    startedAt: '2026-02-01T02:00:00Z',
  });
  const state = buildEngineState({
    workItems: new Map([['wi-1', workItem]]),
    agentRuns: new Map<string, AgentRun>([
      ['sess-1', run1],
      ['sess-2', run2],
      ['sess-3', run3],
    ]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.dispatchCount).toBe(3);
});

test('it assigns correct sections for all work item statuses', () => {
  const statuses = [
    { status: 'pending', expectedSection: 'action', expectedDisplayStatus: 'pending' },
    { status: 'ready', expectedSection: 'action', expectedDisplayStatus: 'dispatch' },
    { status: 'approved', expectedSection: 'action', expectedDisplayStatus: 'approved' },
    {
      status: 'needs-refinement',
      expectedSection: 'action',
      expectedDisplayStatus: 'needs-refinement',
    },
    { status: 'blocked', expectedSection: 'action', expectedDisplayStatus: 'blocked' },
    { status: 'in-progress', expectedSection: 'agents', expectedDisplayStatus: 'implementing' },
    { status: 'review', expectedSection: 'agents', expectedDisplayStatus: 'reviewing' },
  ] as const;

  for (const entry of statuses) {
    const workItem = buildWorkItem({ id: `wi-${entry.status}`, status: entry.status });
    const state = buildEngineState({
      workItems: new Map([[workItem.id, workItem]]),
    });

    const result = getDisplayWorkItems(state);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      displayStatus: entry.expectedDisplayStatus,
      section: entry.expectedSection,
    });
  }
});

test('it does not include runs from other work items in dispatch count', () => {
  const workItem1 = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const workItem2 = buildWorkItem({ id: 'wi-2', status: 'pending' });
  const run1 = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'completed',
  });
  const run2 = buildImplementorRun({
    sessionID: 'sess-2',
    workItemID: 'wi-2',
    status: 'completed',
  });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', workItem1],
      ['wi-2', workItem2],
    ]),
    agentRuns: new Map([
      ['sess-1', run1],
      ['sess-2', run2],
    ]),
  });

  const result = getDisplayWorkItems(state);
  expect(result).toHaveLength(2);

  const wi1Result = result.find((item) => item.workItem.id === 'wi-1');
  const wi2Result = result.find((item) => item.workItem.id === 'wi-2');
  expect(wi1Result?.dispatchCount).toBe(1);
  expect(wi2Result?.dispatchCount).toBe(1);
});
