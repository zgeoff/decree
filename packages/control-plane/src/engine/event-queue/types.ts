import type { EngineEvent } from '../state-store/domain-type-stubs.ts';

export interface EventQueue {
  enqueue: (event: EngineEvent) => void;
  dequeue: () => EngineEvent | undefined;
  isEmpty: () => boolean;
  size: () => number;
  setRejecting: (rejecting: boolean, filter?: EventTypeFilter) => void;
}

export type EventTypeFilter = (eventType: EngineEvent['type']) => boolean;
