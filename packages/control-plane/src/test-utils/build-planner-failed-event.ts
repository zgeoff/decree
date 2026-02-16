import type { PlannerFailed } from '../engine/state-store/types.ts';

export function buildPlannerFailedEvent(overrides?: Partial<PlannerFailed>): PlannerFailed {
  return {
    type: 'plannerFailed',
    specPaths: ['docs/specs/a.md'],
    sessionID: 'session-planner-1',
    error: 'Planner crashed',
    logFilePath: '/logs/planner.log',
    ...overrides,
  };
}
