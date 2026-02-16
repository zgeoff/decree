import type { EngineState, WorkItem } from '../types.ts';

export function getWorkItemsDependingOn(state: EngineState, workItemID: string): WorkItem[] {
  const results: WorkItem[] = [];

  for (const workItem of state.workItems.values()) {
    if (workItem.blockedBy.includes(workItemID)) {
      results.push(workItem);
    }
  }

  return results;
}
