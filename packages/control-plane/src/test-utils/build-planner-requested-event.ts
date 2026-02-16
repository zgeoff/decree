import type { PlannerRequested } from '../engine/state-store/types.ts';

export function buildPlannerRequestedEvent(
  overrides?: Partial<PlannerRequested>,
): PlannerRequested {
  return {
    type: 'plannerRequested',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    sessionID: 'session-planner-1',
    ...overrides,
  };
}
