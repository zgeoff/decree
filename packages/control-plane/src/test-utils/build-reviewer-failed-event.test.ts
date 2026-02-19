import { expect, test } from 'vitest';
import { buildReviewerFailedEvent } from './build-reviewer-failed-event.ts';

test('it returns a reviewer failed event with default values', () => {
  const event = buildReviewerFailedEvent();

  expect(event).toStrictEqual({
    type: 'reviewerFailed',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
    reason: 'error',
    error: 'Reviewer crashed',
    logFilePath: '/logs/reviewer.log',
  });
});

test('it applies overrides to the reviewer failed event', () => {
  const event = buildReviewerFailedEvent({ error: 'Custom error' });

  expect(event).toMatchObject({ error: 'Custom error' });
});
