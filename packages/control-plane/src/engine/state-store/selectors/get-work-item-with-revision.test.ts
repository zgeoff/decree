import { expect, test } from 'vitest';
import type { EngineState, Revision, WorkItem } from '../types.ts';
import { getWorkItemWithRevision } from './get-work-item-with-revision.ts';

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

function buildRevision(overrides: Partial<Revision> & { id: string }): Revision {
  return {
    title: 'Test Revision',
    url: 'https://github.com/test/repo/pull/1',
    headSHA: 'abc123',
    headRef: 'feat/test',
    author: 'test-user',
    body: 'Test body',
    isDraft: false,
    workItemID: null,
    pipeline: null,
    reviewID: null,
    ...overrides,
  };
}

function setupTest(workItems: WorkItem[] = [], revisions: Revision[] = []): EngineState {
  return {
    workItems: new Map(workItems.map((wi) => [wi.id, wi])),
    revisions: new Map(revisions.map((r) => [r.id, r])),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it returns the work item and its linked revision', () => {
  const revision = buildRevision({ id: 'rev-1' });
  const workItem = buildWorkItem({ id: 'wi-1', linkedRevision: 'rev-1' });
  const state = setupTest([workItem], [revision]);

  const result = getWorkItemWithRevision(state, 'wi-1');

  expect(result).toStrictEqual({ workItem, revision });
});

test('it returns null when the work item does not exist', () => {
  const state = setupTest();

  const result = getWorkItemWithRevision(state, 'wi-1');

  expect(result).toBeNull();
});

test('it returns null when the work item has no linked revision', () => {
  const workItem = buildWorkItem({ id: 'wi-1', linkedRevision: null });
  const state = setupTest([workItem]);

  const result = getWorkItemWithRevision(state, 'wi-1');

  expect(result).toBeNull();
});

test('it returns null when the linked revision does not exist in the store', () => {
  const workItem = buildWorkItem({ id: 'wi-1', linkedRevision: 'rev-missing' });
  const state = setupTest([workItem]);

  const result = getWorkItemWithRevision(state, 'wi-1');

  expect(result).toBeNull();
});
