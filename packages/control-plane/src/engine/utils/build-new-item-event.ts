import type { WorkItem, WorkItemChanged } from '../state-store/types.ts';

export function buildNewItemEvent(item: WorkItem): WorkItemChanged {
  return {
    type: 'workItemChanged',
    workItemID: item.id,
    workItem: item,
    title: item.title,
    oldStatus: null,
    newStatus: item.status,
    priority: item.priority,
  };
}
