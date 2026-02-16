import type { EngineState, WorkItem, WorkItemStatus } from '../types.ts';

export function getWorkItemsByStatus(state: EngineState, status: WorkItemStatus): WorkItem[] {
  const results: WorkItem[] = [];

  for (const workItem of state.workItems.values()) {
    if (workItem.status === status) {
      results.push(workItem);
    }
  }

  return results;
}
