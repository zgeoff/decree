import type { PlannerRun } from '../engine/state-store/types.ts';

export function buildPlannerRun(overrides: Partial<PlannerRun> = {}): PlannerRun {
  return {
    role: 'planner',
    sessionID: 'planner-session-1',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}
