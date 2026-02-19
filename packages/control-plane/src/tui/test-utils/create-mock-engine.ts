import { vi } from 'vitest';
import type { StoreApi } from 'zustand';
import { createEngineStore } from '../../engine/state-store/create-engine-store.ts';
import type { EngineState } from '../../engine/state-store/types.ts';
import type { Engine } from '../../engine/v2-engine/types.ts';

export interface MockEngineOverrides {
  start?: Engine['start'];
  stop?: Engine['stop'];
  getWorkItemBody?: Engine['getWorkItemBody'];
  getRevisionFiles?: Engine['getRevisionFiles'];
  getAgentStream?: Engine['getAgentStream'];
}

export interface MockEngineResult {
  engine: Engine;
  store: StoreApi<EngineState>;
}

export function createMockEngine(overrides?: MockEngineOverrides): MockEngineResult {
  const store = createEngineStore();

  const engine: Engine = {
    store,
    start:
      overrides?.start ??
      vi.fn(async () => {
        /* no-op */
      }),
    stop:
      overrides?.stop ??
      vi.fn(async () => {
        /* no-op */
      }),
    enqueue: vi.fn(),
    getState(): EngineState {
      return store.getState();
    },
    subscribe(listener: (state: EngineState) => void): () => void {
      return store.subscribe((state) => {
        listener(state);
      });
    },
    getWorkItemBody: overrides?.getWorkItemBody ?? vi.fn(async () => ''),
    getRevisionFiles: overrides?.getRevisionFiles ?? vi.fn(async () => []),
    getAgentStream: overrides?.getAgentStream ?? vi.fn(() => null),
    refresh: vi.fn(),
  };

  return { engine, store };
}
