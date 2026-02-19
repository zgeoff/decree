import { expect, test } from 'vitest';
import { buildImplementorFailedEvent } from './build-implementor-failed-event.ts';

test('it returns an implementor failed event with default values', () => {
  const event = buildImplementorFailedEvent();

  expect(event).toStrictEqual({
    type: 'implementorFailed',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
    reason: 'error',
    error: 'Implementor crashed',
    logFilePath: '/logs/implementor.log',
  });
});

test('it applies overrides to the implementor failed event', () => {
  const event = buildImplementorFailedEvent({ error: 'Custom error' });

  expect(event).toMatchObject({ error: 'Custom error' });
});
