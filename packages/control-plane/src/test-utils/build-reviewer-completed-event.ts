import type { ReviewerCompleted } from '../engine/state-store/types.ts';

export function buildReviewerCompletedEvent(
  overrides?: Partial<ReviewerCompleted>,
): ReviewerCompleted {
  return {
    type: 'reviewerCompleted',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
    result: {
      role: 'reviewer',
      review: { verdict: 'approve', summary: 'Looks good', comments: [] },
    },
    logFilePath: '/logs/reviewer.log',
    ...overrides,
  };
}
