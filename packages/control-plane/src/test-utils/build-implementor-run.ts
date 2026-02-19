import type { ImplementorRun } from '../engine/state-store/types.ts';

export function buildImplementorRun(overrides: Partial<ImplementorRun> = {}): ImplementorRun {
  return {
    role: 'implementor',
    sessionID: 'implementor-session-1',
    status: 'running',
    workItemID: '1',
    branchName: 'implement/1-work-item',
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}
