import equal from 'fast-deep-equal';
import type { WorkItem, WorkItemChanged } from '../state-store/types.ts';
import { buildChangedItemEvent } from '../utils/build-changed-item-event.ts';
import { buildNewItemEvent } from '../utils/build-new-item-event.ts';
import { buildRemovedItemEvent } from '../utils/build-removed-item-event.ts';
import type { WorkItemPoller, WorkItemPollerConfig } from './types.ts';

const MILLISECONDS_PER_SECOND = 1000;

export function createWorkItemPoller(config: WorkItemPollerConfig): WorkItemPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

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

    if (!started) {
      started = true;
      timer = setInterval(async () => {
        await poll();
      }, config.interval * MILLISECONDS_PER_SECOND);
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

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
    } else if (!equal(providerItem, storedItem)) {
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
