import type { WorkItemChanged } from '../engine/state-store/types.ts';

export function buildWorkItemChangedUpsert(overrides?: Partial<WorkItemChanged>): WorkItemChanged {
  return {
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
    ...overrides,
  };
}
