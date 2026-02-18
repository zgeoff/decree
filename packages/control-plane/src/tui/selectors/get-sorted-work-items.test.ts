import { expect, test } from 'vitest';
import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  ReviewerRun,
} from '../../engine/state-store/types.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { getSortedWorkItems } from './get-sorted-work-items.ts';

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
    startedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

test('it returns an empty array for empty state', () => {
  const state = buildEngineState();
  const result = getSortedWorkItems(state);
  expect(result).toStrictEqual([]);
});

test('it places action section items before agents section items', () => {
  const pendingItem = buildWorkItem({ id: 'wi-1', status: 'pending' });
  const inProgressItem = buildWorkItem({ id: 'wi-2', status: 'in-progress' });
  const readyItem = buildWorkItem({ id: 'wi-3', status: 'ready' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', pendingItem],
      ['wi-2', inProgressItem],
      ['wi-3', readyItem],
    ]),
  });

  const result = getSortedWorkItems(state);
  const sections = result.map((item) => item.section);
  const actionEnd = sections.lastIndexOf('action');
  const agentsStart = sections.indexOf('agents');

  if (agentsStart >= 0) {
    expect(actionEnd).toBeLessThan(agentsStart);
  }
});

test('it sorts by status weight descending within a section', () => {
  const approvedItem = buildWorkItem({ id: 'wi-1', status: 'approved' });
  const pendingItem = buildWorkItem({ id: 'wi-2', status: 'pending' });
  const blockedItem = buildWorkItem({ id: 'wi-3', status: 'blocked' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', approvedItem],
      ['wi-2', pendingItem],
      ['wi-3', blockedItem],
    ]),
  });

  const result = getSortedWorkItems(state);
  const displayStatuses = result.map((item) => item.displayStatus);
  // approved (100) > blocked (80) > pending (50)
  expect(displayStatuses).toStrictEqual(['approved', 'blocked', 'pending']);
});

test('it sorts by priority weight descending when status weights are equal', () => {
  const lowPriority = buildWorkItem({ id: 'wi-1', status: 'ready', priority: 'low' });
  const highPriority = buildWorkItem({ id: 'wi-2', status: 'ready', priority: 'high' });
  const mediumPriority = buildWorkItem({ id: 'wi-3', status: 'ready', priority: 'medium' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', lowPriority],
      ['wi-2', highPriority],
      ['wi-3', mediumPriority],
    ]),
  });

  const result = getSortedWorkItems(state);
  const ids = result.map((item) => item.workItem.id);
  // high (3) > medium (2) > low (1)
  expect(ids).toStrictEqual(['wi-2', 'wi-3', 'wi-1']);
});

test('it sorts by work item id ascending (lexicographic) when status and priority are equal', () => {
  const itemA = buildWorkItem({ id: 'wi-10', status: 'pending', priority: 'medium' });
  const itemB = buildWorkItem({ id: 'wi-2', status: 'pending', priority: 'medium' });
  const itemC = buildWorkItem({ id: 'wi-1', status: 'pending', priority: 'medium' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-10', itemA],
      ['wi-2', itemB],
      ['wi-1', itemC],
    ]),
  });

  const result = getSortedWorkItems(state);
  const ids = result.map((item) => item.workItem.id);
  // Lexicographic: "wi-1" < "wi-10" < "wi-2"
  expect(ids).toStrictEqual(['wi-1', 'wi-10', 'wi-2']);
});

test('it treats null priority as weight zero', () => {
  const nullPriority = buildWorkItem({ id: 'wi-1', status: 'ready', priority: null });
  const lowPriority = buildWorkItem({ id: 'wi-2', status: 'ready', priority: 'low' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', nullPriority],
      ['wi-2', lowPriority],
    ]),
  });

  const result = getSortedWorkItems(state);
  const ids = result.map((item) => item.workItem.id);
  // low (1) > null (0)
  expect(ids).toStrictEqual(['wi-2', 'wi-1']);
});

test('it sorts agents section items independently from action items', () => {
  const implementingRun = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-impl',
    status: 'running',
    startedAt: '2026-02-01T00:00:00Z',
  });
  const reviewingRun = buildReviewerRun({
    sessionID: 'sess-2',
    workItemID: 'wi-rev',
    status: 'running',
    startedAt: '2026-02-01T00:00:00Z',
  });

  const implementingItem = buildWorkItem({ id: 'wi-impl', status: 'in-progress', priority: 'low' });
  const reviewingItem = buildWorkItem({ id: 'wi-rev', status: 'review', priority: 'high' });
  const pendingItem = buildWorkItem({ id: 'wi-pending', status: 'pending', priority: 'high' });

  const state = buildEngineState({
    workItems: new Map([
      ['wi-impl', implementingItem],
      ['wi-rev', reviewingItem],
      ['wi-pending', pendingItem],
    ]),
    agentRuns: new Map<string, AgentRun>([
      ['sess-1', implementingRun],
      ['sess-2', reviewingRun],
    ]),
  });

  const result = getSortedWorkItems(state);
  // ACTION section first (pending), then AGENTS (reviewing high > implementing low)
  expect(result[0]?.workItem.id).toBe('wi-pending');
  expect(result[1]?.workItem.id).toBe('wi-rev');
  expect(result[2]?.workItem.id).toBe('wi-impl');
});

test('it excludes closed work items from sorted results', () => {
  const closedItem = buildWorkItem({ id: 'wi-1', status: 'closed' });
  const pendingItem = buildWorkItem({ id: 'wi-2', status: 'pending' });
  const state = buildEngineState({
    workItems: new Map([
      ['wi-1', closedItem],
      ['wi-2', pendingItem],
    ]),
  });

  const result = getSortedWorkItems(state);
  expect(result).toHaveLength(1);
  expect(result[0]?.workItem.id).toBe('wi-2');
});

test('it handles mixed status weights with full three-level sort chain', () => {
  // failed (90) high > failed (90) low > blocked (80) high > dispatch (50) medium > dispatch (50) low
  const failedRunForWi1 = buildImplementorRun({
    sessionID: 'sess-1',
    workItemID: 'wi-1',
    status: 'failed',
  });
  const failedRunForWi2 = buildImplementorRun({
    sessionID: 'sess-2',
    workItemID: 'wi-2',
    status: 'failed',
  });

  const items = [
    buildWorkItem({ id: 'wi-5', status: 'ready', priority: 'low' }),
    buildWorkItem({ id: 'wi-1', status: 'ready', priority: 'high' }),
    buildWorkItem({ id: 'wi-3', status: 'blocked', priority: 'high' }),
    buildWorkItem({ id: 'wi-4', status: 'ready', priority: 'medium' }),
    buildWorkItem({ id: 'wi-2', status: 'ready', priority: 'low' }),
  ];

  const state = buildEngineState({
    workItems: new Map(items.map((item) => [item.id, item])),
    agentRuns: new Map([
      ['sess-1', failedRunForWi1],
      ['sess-2', failedRunForWi2],
    ]),
  });

  const result = getSortedWorkItems(state);
  const ids = result.map((item) => item.workItem.id);
  // failed(90)/high(3): wi-1
  // failed(90)/low(1): wi-2
  // blocked(80)/high(3): wi-3
  // dispatch(50)/medium(2): wi-4
  // dispatch(50)/low(1): wi-5
  expect(ids).toStrictEqual(['wi-1', 'wi-2', 'wi-3', 'wi-4', 'wi-5']);
});
