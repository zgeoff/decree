import type { ImplementorCompleted } from '../engine/state-store/types.ts';

export function buildImplementorCompletedEvent(
  overrides?: Partial<ImplementorCompleted>,
): ImplementorCompleted {
  const workItemID = overrides?.workItemID ?? 'wi-1';
  return {
    type: 'implementorCompleted',
    workItemID,
    sessionID: 'session-impl-1',
    branchName: `decree/${workItemID}`,
    result: { role: 'implementor', outcome: 'completed', patch: 'diff', summary: 'Done' },
    logFilePath: '/logs/implementor.log',
    ...overrides,
  };
}
