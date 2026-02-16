import type { ReviewerRequested } from '../engine/state-store/types.ts';

export function buildReviewerRequestedEvent(
  overrides?: Partial<ReviewerRequested>,
): ReviewerRequested {
  return {
    type: 'reviewerRequested',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
    ...overrides,
  };
}
