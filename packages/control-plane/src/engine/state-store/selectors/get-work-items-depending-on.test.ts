import { expect, test } from 'vitest';
import type { EngineState, WorkItem } from '../types.ts';
import { getWorkItemsDependingOn } from './get-work-items-depending-on.ts';

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

test('it returns work items that list the given ID in their blockedBy list', () => {
  const blocker = buildWorkItem({ id: 'blocker-1' });
  const dependent1 = buildWorkItem({ id: 'dep-1', blockedBy: ['blocker-1'] });
  const dependent2 = buildWorkItem({ id: 'dep-2', blockedBy: ['blocker-1', 'blocker-2'] });
  const unrelated = buildWorkItem({ id: 'unrelated' });
  const state = setupTest([blocker, dependent1, dependent2, unrelated]);

  const result = getWorkItemsDependingOn(state, 'blocker-1');

  expect(result).toStrictEqual([dependent1, dependent2]);
});

test('it returns an empty array when no work items depend on the given ID', () => {
  const item = buildWorkItem({ id: 'wi-1' });
  const state = setupTest([item]);

  const result = getWorkItemsDependingOn(state, 'wi-2');

  expect(result).toStrictEqual([]);
});

test('it returns an empty array when the store has no work items', () => {
  const state = setupTest();

  const result = getWorkItemsDependingOn(state, 'wi-1');

  expect(result).toStrictEqual([]);
});

test('it does not include the blocker work item itself in the results', () => {
  const blocker = buildWorkItem({ id: 'blocker-1' });
  const dependent = buildWorkItem({ id: 'dep-1', blockedBy: ['blocker-1'] });
  const state = setupTest([blocker, dependent]);

  const result = getWorkItemsDependingOn(state, 'blocker-1');

  expect(result).toStrictEqual([dependent]);
});
