import type { ReviewerStarted } from '../engine/state-store/types.ts';

export function buildReviewerStartedEvent(overrides?: Partial<ReviewerStarted>): ReviewerStarted {
  return {
    type: 'reviewerStarted',
    sessionID: 'session-reviewer-1',
    logFilePath: '/logs/reviewer.log',
    ...overrides,
  };
}
