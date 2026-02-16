import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { EngineState } from './types.ts';

export function createEngineStore(): StoreApi<EngineState> {
  return createStore<EngineState>(() => ({
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  }));
}
