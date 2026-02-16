import type { EngineState, WorkItem } from '../types.ts';

export function isWorkItemUnblocked(state: EngineState, workItem: WorkItem): boolean {
  if (workItem.blockedBy.length === 0) {
    return true;
  }

  for (const blockerID of workItem.blockedBy) {
    const blocker = state.workItems.get(blockerID);

    if (!blocker) {
      return false;
    }

    if (blocker.status !== 'closed' && blocker.status !== 'approved') {
      return false;
    }
  }

  return true;
}
