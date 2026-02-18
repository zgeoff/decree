import type { EngineEvent } from '../state-store/domain-type-stubs.ts';
import type { EventQueue, EventTypeFilter } from './types.ts';

export function createEventQueue(): EventQueue {
  const queue: EngineEvent[] = [];
  let rejecting = false;
  let filter: EventTypeFilter | undefined;

  return {
    enqueue(event: EngineEvent): void {
      if (rejecting) {
        const allowed = filter?.(event.type);
        if (!allowed) {
          throw new Error('Event queue is rejecting new events (shutdown in progress)');
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
