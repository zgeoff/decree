import { expect, test } from 'vitest';
import type { EngineState, WorkItem } from '../types.ts';
import { getWorkItemsByStatus } from './get-work-items-by-status.ts';

function buildWorkItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: 'Test Work Item',
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-01-01T00:00:00Z',
    linkedRevision: null,
    ...overrides,
  };
}

function setupTest(workItems: WorkItem[] = []): EngineState {
  return {
    workItems: new Map(workItems.map((wi) => [wi.id, wi])),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it returns work items matching the given status', () => {
  const pending1 = buildWorkItem({ id: '1', status: 'pending' });
  const pending2 = buildWorkItem({ id: '2', status: 'pending' });
  const inProgress = buildWorkItem({ id: '3', status: 'in-progress' });
  const state = setupTest([pending1, pending2, inProgress]);

  const result = getWorkItemsByStatus(state, 'pending');

  expect(result).toStrictEqual([pending1, pending2]);
});

test('it returns an empty array when no work items match the status', () => {
  const pending = buildWorkItem({ id: '1', status: 'pending' });
  const state = setupTest([pending]);

  const result = getWorkItemsByStatus(state, 'closed');

  expect(result).toStrictEqual([]);
});

test('it returns an empty array when the store has no work items', () => {
  const state = setupTest();

  const result = getWorkItemsByStatus(state, 'pending');

  expect(result).toStrictEqual([]);
});

test('it returns work items for each distinct status independently', () => {
  const pending = buildWorkItem({ id: '1', status: 'pending' });
  const closed = buildWorkItem({ id: '2', status: 'closed' });
  const approved = buildWorkItem({ id: '3', status: 'approved' });
  const state = setupTest([pending, closed, approved]);

  expect(getWorkItemsByStatus(state, 'pending')).toStrictEqual([pending]);
  expect(getWorkItemsByStatus(state, 'closed')).toStrictEqual([closed]);
  expect(getWorkItemsByStatus(state, 'approved')).toStrictEqual([approved]);
});
