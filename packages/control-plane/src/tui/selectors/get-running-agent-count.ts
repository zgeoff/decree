import type { EngineState } from '../../engine/state-store/types.ts';

export function getRunningAgentCount(state: EngineState): number {
  let count = 0;
  for (const run of state.agentRuns.values()) {
    if (run.status === 'requested' || run.status === 'running') {
      count += 1;
    }
  }
  return count;
}
