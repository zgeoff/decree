import { vi } from 'vitest';
import type { EngineEvent } from '../engine/state-store/domain-type-stubs.ts';

export interface MockEnqueueResult {
  enqueue: (event: EngineEvent) => void;
  events: EngineEvent[];
}

export function createMockEnqueue(): MockEnqueueResult {
  const events: EngineEvent[] = [];
  const enqueue = vi.fn().mockImplementation((event: EngineEvent) => {
    events.push(event);
  });
  return { enqueue, events };
}
