import type { ImplementorCompleted } from '../engine/state-store/types.ts';

export function buildImplementorCompletedEvent(
  overrides?: Partial<ImplementorCompleted>,
): ImplementorCompleted {
  return {
    type: 'implementorCompleted',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
    result: { role: 'implementor', outcome: 'completed', patch: 'diff', summary: 'Done' },
    logFilePath: '/logs/implementor.log',
    ...overrides,
  };
}
