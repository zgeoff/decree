import { expect, test } from 'vitest';
import { buildReviewerStartedEvent } from './build-reviewer-started-event.ts';

test('it returns a reviewer started event with default values', () => {
  const event = buildReviewerStartedEvent();

  expect(event).toStrictEqual({
    type: 'reviewerStarted',
    sessionID: 'session-reviewer-1',
    logFilePath: '/logs/reviewer.log',
  });
});

test('it applies overrides to the reviewer started event', () => {
  const event = buildReviewerStartedEvent({ logFilePath: '/custom/path.log' });

  expect(event).toMatchObject({ logFilePath: '/custom/path.log' });
});
