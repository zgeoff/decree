import type { WorkItem, WorkItemChanged } from '../state-store/types.ts';

export function buildChangedItemEvent(
  providerItem: WorkItem,
  storedItem: WorkItem,
): WorkItemChanged {
  return {
    type: 'workItemChanged',
    workItemID: providerItem.id,
    workItem: providerItem,
    title: providerItem.title,
    oldStatus: storedItem.status,
    newStatus: providerItem.status,
    priority: providerItem.priority,
  };
}
