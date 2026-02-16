import { expect, test } from 'vitest';
import { buildReviewerRequestedEvent } from './build-reviewer-requested-event.ts';

test('it returns a reviewer requested event with default values', () => {
  const event = buildReviewerRequestedEvent();

  expect(event).toStrictEqual({
    type: 'reviewerRequested',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    sessionID: 'session-reviewer-1',
  });
});

test('it applies overrides to the reviewer requested event', () => {
  const event = buildReviewerRequestedEvent({ revisionID: 'rev-99' });

  expect(event).toMatchObject({ revisionID: 'rev-99' });
});
