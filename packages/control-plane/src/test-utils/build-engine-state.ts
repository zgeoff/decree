import type { EngineState } from '../engine/state-store/types.ts';

export function buildEngineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
    ...overrides,
  };
}
