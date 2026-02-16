import type { EngineState, WorkItemWithRevision } from '../types.ts';

export function getWorkItemWithRevision(
  state: EngineState,
  workItemID: string,
): WorkItemWithRevision | null {
  const workItem = state.workItems.get(workItemID);

  if (!workItem) {
    return null;
  }

  if (!workItem.linkedRevision) {
    return null;
  }

  const revision = state.revisions.get(workItem.linkedRevision);

  if (!revision) {
    return null;
  }

  return { workItem, revision };
}
