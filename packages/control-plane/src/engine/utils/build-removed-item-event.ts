import type { WorkItem, WorkItemChanged } from '../state-store/types.ts';

export function buildRemovedItemEvent(storedItem: WorkItem): WorkItemChanged {
  return {
    type: 'workItemChanged',
    workItemID: storedItem.id,
    workItem: storedItem,
    title: storedItem.title,
    oldStatus: storedItem.status,
    newStatus: null,
    priority: storedItem.priority,
  };
}
