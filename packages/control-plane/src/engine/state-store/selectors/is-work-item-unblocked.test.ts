import { expect, test } from 'vitest';
import type { EngineState, WorkItem } from '../types.ts';
import { isWorkItemUnblocked } from './is-work-item-unblocked.ts';

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

test('it returns true when the work item has an empty blockedBy list', () => {
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: [] });
  const state = setupTest([workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(true);
});

test('it returns true when all blockers are in closed status', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'closed' });
  const blockerB = buildWorkItem({ id: 'B', status: 'closed' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A', 'B'] });
  const state = setupTest([blockerA, blockerB, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(true);
});

test('it returns true when all blockers are in approved status', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'approved' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A'] });
  const state = setupTest([blockerA, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(true);
});

test('it returns true when blockers are in mixed terminal statuses', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'closed' });
  const blockerB = buildWorkItem({ id: 'B', status: 'approved' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A', 'B'] });
  const state = setupTest([blockerA, blockerB, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(true);
});

test('it returns false when a blocker is in a non-terminal status', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'in-progress' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A'] });
  const state = setupTest([blockerA, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(false);
});

test('it returns false when a blocker ID does not exist in the work items map', () => {
  const blockerB = buildWorkItem({ id: 'B', status: 'closed' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['B', 'C'] });
  const state = setupTest([blockerB, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(false);
});

test('it returns false when one blocker is terminal and another is not found', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'closed' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A', 'missing'] });
  const state = setupTest([blockerA, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(false);
});

test('it returns false when one blocker is terminal and another is pending', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'closed' });
  const blockerB = buildWorkItem({ id: 'B', status: 'pending' });
  const workItem = buildWorkItem({ id: 'wi-1', blockedBy: ['A', 'B'] });
  const state = setupTest([blockerA, blockerB, workItem]);

  expect(isWorkItemUnblocked(state, workItem)).toBe(false);
});
