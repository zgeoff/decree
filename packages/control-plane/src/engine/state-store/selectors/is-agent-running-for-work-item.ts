import type { EngineState } from '../types.ts';

export function isAgentRunningForWorkItem(state: EngineState, workItemID: string): boolean {
  for (const run of state.agentRuns.values()) {
    if (
      run.role !== 'planner' &&
      run.workItemID === workItemID &&
      (run.status === 'requested' || run.status === 'running')
    ) {
      return true;
    }
  }

  return false;
}
