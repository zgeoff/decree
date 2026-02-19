import type { ImplementorFailed } from '../engine/state-store/types.ts';

export function buildImplementorFailedEvent(
  overrides?: Partial<ImplementorFailed>,
): ImplementorFailed {
  return {
    type: 'implementorFailed',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
    reason: 'error',
    error: 'Implementor crashed',
    logFilePath: '/logs/implementor.log',
    ...overrides,
  };
}
