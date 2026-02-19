import type { ReviewerRun } from '../engine/state-store/types.ts';

export function buildReviewerRun(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    role: 'reviewer',
    sessionID: 'reviewer-session-1',
    status: 'running',
    workItemID: '1',
    revisionID: '1',
    logFilePath: null,
    error: null,
    startedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}
