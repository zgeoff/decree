import { expect, test } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildNewItemEvent } from './build-new-item-event.ts';

test('it builds a new item event with null old status', () => {
  const item = buildWorkItem({
    id: 'wi-1',
    title: 'New task',
    status: 'pending',
    priority: 'high',
  });
  const event = buildNewItemEvent(item);

  expect(event).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: item,
    title: 'New task',
    oldStatus: null,
    newStatus: 'pending',
    priority: 'high',
  });
});

test('it sets priority to null when the work item has no priority', () => {
  const item = buildWorkItem({ id: 'wi-2' });
  const event = buildNewItemEvent(item);

  expect(event.priority).toBeNull();
});
