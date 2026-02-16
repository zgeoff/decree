import type { ImplementorRequested } from '../engine/state-store/types.ts';

export function buildImplementorRequestedEvent(
  overrides?: Partial<ImplementorRequested>,
): ImplementorRequested {
  return {
    type: 'implementorRequested',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
    ...overrides,
  };
}
