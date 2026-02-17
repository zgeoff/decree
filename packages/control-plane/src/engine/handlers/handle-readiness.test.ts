import { expect, test } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { EngineState, WorkItem } from '../state-store/types.ts';
import { handleReadiness } from './handle-readiness.ts';

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

test('it emits a ready transition when a work item becomes pending with no blockers', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending', blockedBy: [] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    workItem,
    newStatus: 'pending',
  });
  const state = buildState([workItem]);

  const commands = handleReadiness(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-1', newStatus: 'ready' },
  ]);
});

test('it emits a ready transition when a work item becomes pending and all blockers are in terminal status', () => {
  const blockerB = buildWorkItem({ id: 'B', status: 'closed' });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending', blockedBy: ['B'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    workItem,
    newStatus: 'pending',
  });
  const state = buildState([blockerB, workItem]);

  const commands = handleReadiness(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-1', newStatus: 'ready' },
  ]);
});

test('it returns no commands when a work item becomes pending but a blocker is not in terminal status', () => {
  const blockerB = buildWorkItem({ id: 'B', status: 'in-progress' });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending', blockedBy: ['B'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    workItem,
    newStatus: 'pending',
  });
  const state = buildState([blockerB, workItem]);

  const commands = handleReadiness(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when a work item becomes pending but a blocker is not present in the store', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'pending', blockedBy: ['B'] });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    workItem,
    newStatus: 'pending',
  });
  const state = buildState([workItem]);

  const commands = handleReadiness(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the new status is not pending', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    workItem,
    newStatus: 'ready',
    oldStatus: 'pending',
  });
  const state = buildState([workItem]);

  const commands = handleReadiness(event, state);

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

  const commands = handleReadiness(event, state);

  expect(commands).toStrictEqual([]);
});
