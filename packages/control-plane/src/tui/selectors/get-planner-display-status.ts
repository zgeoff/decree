import { getActivePlannerRun } from '../../engine/state-store/selectors/get-active-planner-run.ts';
import type { EngineState } from '../../engine/state-store/types.ts';
import type { PlannerDisplayStatus } from './types.ts';

export function getPlannerDisplayStatus(state: EngineState): PlannerDisplayStatus {
  const activePlannerRun = getActivePlannerRun(state);
  return activePlannerRun !== null ? 'running' : 'idle';
}
