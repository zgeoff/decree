import { expect, test } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { EngineState, WorkItem } from '../state-store/types.ts';
import { handleDependencyResolution } from './handle-dependency-resolution.ts';

function buildState(workItems: WorkItem[] = []): EngineState {
  return {
    workItems: new Map(workItems.map((wi) => [wi.id, wi])),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it emits a ready transition for a pending dependent when its last blocker resolves to closed', () => {
  const blocker = buildWorkItem({ id: 'A', status: 'closed' });
  const dependent = buildWorkItem({ id: 'wi-dep', status: 'pending', blockedBy: ['A'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem: blocker,
    newStatus: 'closed',
    oldStatus: 'in-progress',
  });
  const state = buildState([blocker, dependent]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-dep', newStatus: 'ready' },
  ]);
});

test('it emits a ready transition for a pending dependent when its last blocker resolves to approved', () => {
  const blocker = buildWorkItem({ id: 'A', status: 'approved' });
  const dependent = buildWorkItem({ id: 'wi-dep', status: 'pending', blockedBy: ['A'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem: blocker,
    newStatus: 'approved',
    oldStatus: 'review',
  });
  const state = buildState([blocker, dependent]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-dep', newStatus: 'ready' },
  ]);
});

test('it returns no commands for a pending dependent that still has an unresolved blocker', () => {
  const blockerA = buildWorkItem({ id: 'A', status: 'closed' });
  const blockerB = buildWorkItem({ id: 'B', status: 'in-progress' });
  const dependent = buildWorkItem({ id: 'wi-dep', status: 'pending', blockedBy: ['A', 'B'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem: blockerA,
    newStatus: 'closed',
    oldStatus: 'in-progress',
  });
  const state = buildState([blockerA, blockerB, dependent]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for a dependent in blocked status even when all blockers are resolved', () => {
  const blocker = buildWorkItem({ id: 'A', status: 'closed' });
  const dependent = buildWorkItem({ id: 'wi-dep', status: 'blocked', blockedBy: ['A'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem: blocker,
    newStatus: 'closed',
    oldStatus: 'in-progress',
  });
  const state = buildState([blocker, dependent]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([]);
});

test('it emits ready transitions for multiple eligible dependents', () => {
  const blocker = buildWorkItem({ id: 'A', status: 'closed' });
  const depOne = buildWorkItem({ id: 'wi-dep-1', status: 'pending', blockedBy: ['A'] });
  const depTwo = buildWorkItem({ id: 'wi-dep-2', status: 'pending', blockedBy: ['A'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem: blocker,
    newStatus: 'closed',
    oldStatus: 'in-progress',
  });
  const state = buildState([blocker, depOne, depTwo]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-dep-1', newStatus: 'ready' },
    { command: 'transitionWorkItemStatus', workItemID: 'wi-dep-2', newStatus: 'ready' },
  ]);
});

test('it returns no commands when the new status is not closed or approved', () => {
  const workItem = buildWorkItem({ id: 'A', status: 'in-progress' });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'A',
    workItem,
    newStatus: 'in-progress',
    oldStatus: 'ready',
  });
  const state = buildState([workItem]);

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for non-work-item-changed events', () => {
  const state = buildState();
  const event = {
    type: 'specChanged' as const,
    filePath: 'docs/specs/test.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved' as const,
    changeType: 'modified' as const,
    commitSHA: 'commit-1',
  };

  const commands = handleDependencyResolution(event, state);

  expect(commands).toStrictEqual([]);
});
