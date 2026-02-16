import { expect, test } from 'vitest';
import { buildWorkItem } from './build-work-item.ts';

test('it returns a work item with default values', () => {
  const item = buildWorkItem({ id: 'wi-1' });

  expect(item).toStrictEqual({
    id: 'wi-1',
    title: 'Work item wi-1',
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-02-01T00:00:00Z',
    linkedRevision: null,
  });
});

test('it applies overrides to the work item', () => {
  const item = buildWorkItem({ id: 'wi-99', title: 'Custom title', status: 'in-progress' });

  expect(item).toMatchObject({ id: 'wi-99', title: 'Custom title', status: 'in-progress' });
});
