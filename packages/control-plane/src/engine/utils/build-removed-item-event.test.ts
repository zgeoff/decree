import { expect, test } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildRemovedItemEvent } from './build-removed-item-event.ts';

test('it builds a removed item event with null new status', () => {
  const item = buildWorkItem({ id: 'wi-1', status: 'in-progress', priority: 'high' });
  const event = buildRemovedItemEvent(item);

  expect(event).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: item,
    title: 'Work item wi-1',
    oldStatus: 'in-progress',
    newStatus: null,
    priority: 'high',
  });
});

test('it preserves the stored item priority in the event', () => {
  const item = buildWorkItem({ id: 'wi-2', priority: 'low' });
  const event = buildRemovedItemEvent(item);

  expect(event.priority).toBe('low');
});
