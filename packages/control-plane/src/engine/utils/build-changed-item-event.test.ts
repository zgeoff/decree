import { expect, test } from 'vitest';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildChangedItemEvent } from './build-changed-item-event.ts';

test('it builds a changed item event with old and new status', () => {
  const storedItem = buildWorkItem({ id: 'wi-1', status: 'pending', priority: 'medium' });
  const providerItem = buildWorkItem({ id: 'wi-1', status: 'in-progress', priority: 'high' });
  const event = buildChangedItemEvent(providerItem, storedItem);

  expect(event).toStrictEqual({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    workItem: providerItem,
    title: 'Work item wi-1',
    oldStatus: 'pending',
    newStatus: 'in-progress',
    priority: 'high',
  });
});

test('it uses the provider item title in the event', () => {
  const storedItem = buildWorkItem({ id: 'wi-1', title: 'Old title' });
  const providerItem = buildWorkItem({ id: 'wi-1', title: 'New title' });
  const event = buildChangedItemEvent(providerItem, storedItem);

  expect(event.title).toBe('New title');
});
