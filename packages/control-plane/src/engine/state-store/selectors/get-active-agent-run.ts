import type { EngineState, ImplementorRun, ReviewerRun } from '../types.ts';

export function getActiveAgentRun(
  state: EngineState,
  workItemID: string,
): ImplementorRun | ReviewerRun | null {
  for (const run of state.agentRuns.values()) {
    if (
      run.role !== 'planner' &&
      run.workItemID === workItemID &&
      (run.status === 'requested' || run.status === 'running')
    ) {
      return run;
    }
  }

  return null;
}
