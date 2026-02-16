import type { PlannerStarted } from '../engine/state-store/types.ts';

export function buildPlannerStartedEvent(overrides?: Partial<PlannerStarted>): PlannerStarted {
  return {
    type: 'plannerStarted',
    sessionID: 'session-planner-1',
    logFilePath: '/logs/planner.log',
    ...overrides,
  };
}
