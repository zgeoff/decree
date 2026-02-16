import { expect, test } from 'vitest';
import { buildWorkItemChangedRemoval } from './build-work-item-changed-removal.ts';

test('it returns a work item removal event with default values', () => {
  const event = buildWorkItemChangedRemoval();

  expect(event).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: {
      id: 'wi-1',
      title: 'Removed item',
      status: 'pending',
      priority: null,
      complexity: null,
      blockedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      linkedRevision: null,
    },
    title: 'Removed item',
    oldStatus: 'pending',
    newStatus: null,
    priority: null,
  });
});

test('it applies overrides to the work item removal event', () => {
  const event = buildWorkItemChangedRemoval({ workItemID: 'wi-99', oldStatus: 'ready' });

  expect(event).toMatchObject({ workItemID: 'wi-99', oldStatus: 'ready' });
});
