import type { EngineEvent } from '../state-store/domain-type-stubs.ts';
import type { EventQueue, EventQueueConfig, EventTypeFilter } from './types.ts';

export function createEventQueue(config: EventQueueConfig): EventQueue {
  const queue: EngineEvent[] = [];
  let rejecting = false;
  let filter: EventTypeFilter | undefined;

  return {
    enqueue(event: EngineEvent): void {
      if (rejecting) {
        const allowed = filter?.(event.type);
        if (!allowed) {
          config.logger.error('event rejected during shutdown', { eventType: event.type });
          return;
        }
      }
      queue.push(event);
    },

    dequeue(): EngineEvent | undefined {
      return queue.shift();
    },

    isEmpty(): boolean {
      return queue.length === 0;
    },

    size(): number {
      return queue.length;
    },

    setRejecting(newRejecting: boolean, newFilter?: EventTypeFilter): void {
      rejecting = newRejecting;
      filter = newFilter;
    },
  };
}
