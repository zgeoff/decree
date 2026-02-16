import type { WorkItemChanged } from '../engine/state-store/types.ts';

export function buildWorkItemChangedRemoval(overrides?: Partial<WorkItemChanged>): WorkItemChanged {
  return {
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
    ...overrides,
  };
}
