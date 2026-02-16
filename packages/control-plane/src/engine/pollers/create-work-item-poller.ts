import type { WorkItem, WorkItemChanged } from '../state-store/domain-type-stubs.ts';
import type { WorkItemPoller, WorkItemPollerConfig } from './types.ts';

const MILLISECONDS_PER_SECOND = 1000;

export function createWorkItemPoller(config: WorkItemPollerConfig): WorkItemPoller {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    try {
      const providerItems = await config.reader.listWorkItems();
      const state = config.getState();
      const storedItems = state.workItems;

      const providerMap = new Map<string, WorkItem>();
      for (const item of providerItems) {
        providerMap.set(item.id, item);
      }

      detectNewAndChangedItems(providerMap, storedItems, config.enqueue);
      detectRemovedItems(providerMap, storedItems, config.enqueue);
    } catch {
      // Provider reader failed — skip this cycle, next interval proceeds normally
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  timer = setInterval(async () => {
    await poll();
  }, config.interval * MILLISECONDS_PER_SECOND);

  return { poll, stop };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectNewAndChangedItems(
  providerMap: Map<string, WorkItem>,
  storedItems: Map<string, WorkItem>,
  enqueue: (event: WorkItemChanged) => void,
): void {
  for (const [id, providerItem] of providerMap) {
    const storedItem = storedItems.get(id);

    if (!storedItem) {
      enqueue(buildNewItemEvent(providerItem));
    } else if (!isStructurallyEqual(providerItem, storedItem)) {
      enqueue(buildChangedItemEvent(providerItem, storedItem));
    }
  }
}

function detectRemovedItems(
  providerMap: Map<string, WorkItem>,
  storedItems: Map<string, WorkItem>,
  enqueue: (event: WorkItemChanged) => void,
): void {
  for (const [id, storedItem] of storedItems) {
    if (!providerMap.has(id)) {
      enqueue(buildRemovedItemEvent(storedItem));
    }
  }
}

function buildNewItemEvent(item: WorkItem): WorkItemChanged {
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

function buildChangedItemEvent(providerItem: WorkItem, storedItem: WorkItem): WorkItemChanged {
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

function buildRemovedItemEvent(storedItem: WorkItem): WorkItemChanged {
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

function isStructurallyEqual(a: WorkItem, b: WorkItem): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.complexity === b.complexity &&
    a.createdAt === b.createdAt &&
    a.linkedRevision === b.linkedRevision &&
    areBlockedByEqual(a.blockedBy, b.blockedBy)
  );
}

function areBlockedByEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
