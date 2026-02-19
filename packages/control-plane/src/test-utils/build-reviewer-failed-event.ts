import type { ReviewerFailed } from '../engine/state-store/types.ts';

export function buildReviewerFailedEvent(overrides?: Partial<ReviewerFailed>): ReviewerFailed {
  return {
    type: 'reviewerFailed',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
    reason: 'error',
    error: 'Reviewer crashed',
    logFilePath: '/logs/reviewer.log',
    ...overrides,
  };
}
