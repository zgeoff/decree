import type { ImplementorStarted } from '../engine/state-store/types.ts';

export function buildImplementorStartedEvent(
  overrides?: Partial<ImplementorStarted>,
): ImplementorStarted {
  return {
    type: 'implementorStarted',
    sessionID: 'session-impl-1',
    logFilePath: '/logs/implementor.log',
    ...overrides,
  };
}
