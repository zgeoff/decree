import type { WorkItem } from '../engine/state-store/types.ts';

export function buildWorkItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Work item ${overrides.id}`,
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-02-01T00:00:00Z',
    linkedRevision: null,
    ...overrides,
  };
}
