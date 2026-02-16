import type { EngineState, PlannerRun } from '../types.ts';

export function getActivePlannerRun(state: EngineState): PlannerRun | null {
  for (const run of state.agentRuns.values()) {
    if (run.role === 'planner' && (run.status === 'requested' || run.status === 'running')) {
      return run;
    }
  }

  return null;
}
