import { expect, test } from 'vitest';
import { buildWorkItemChangedUpsert } from './build-work-item-changed-upsert.ts';

test('it returns a work item upsert event with default values', () => {
  const event = buildWorkItemChangedUpsert();

  expect(event).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: {
      id: 'wi-1',
      title: 'Test work item',
      status: 'pending',
      priority: null,
      complexity: null,
      blockedBy: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      linkedRevision: null,
    },
    title: 'Test work item',
    oldStatus: null,
    newStatus: 'pending',
    priority: null,
  });
});

test('it applies overrides to the work item upsert event', () => {
  const event = buildWorkItemChangedUpsert({ workItemID: 'wi-99', newStatus: 'ready' });

  expect(event).toMatchObject({ workItemID: 'wi-99', newStatus: 'ready' });
});
