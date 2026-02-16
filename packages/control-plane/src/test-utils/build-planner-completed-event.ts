import type { PlannerCompleted } from '../engine/state-store/types.ts';

export function buildPlannerCompletedEvent(
  overrides?: Partial<PlannerCompleted>,
): PlannerCompleted {
  return {
    type: 'plannerCompleted',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    sessionID: 'session-planner-1',
    result: { role: 'planner', create: [], close: [], update: [] },
    logFilePath: '/logs/planner.log',
    ...overrides,
  };
}
