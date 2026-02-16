import { expect, test } from 'vitest';
import { buildReviewerCompletedEvent } from './build-reviewer-completed-event.ts';

test('it returns a reviewer completed event with default values', () => {
  const event = buildReviewerCompletedEvent();

  expect(event).toStrictEqual({
    type: 'reviewerCompleted',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
    result: {
      role: 'reviewer',
      review: { verdict: 'approve', summary: 'Looks good', comments: [] },
    },
    logFilePath: '/logs/reviewer.log',
  });
});

test('it applies overrides to the reviewer completed event', () => {
  const event = buildReviewerCompletedEvent({ workItemID: 'wi-99' });

  expect(event).toMatchObject({ workItemID: 'wi-99' });
});
