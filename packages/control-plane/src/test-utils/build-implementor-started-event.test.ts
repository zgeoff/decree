import { expect, test } from 'vitest';
import { buildImplementorStartedEvent } from './build-implementor-started-event.ts';

test('it returns an implementor started event with default values', () => {
  const event = buildImplementorStartedEvent();

  expect(event).toStrictEqual({
    type: 'implementorStarted',
    sessionID: 'session-impl-1',
    logFilePath: '/logs/implementor.log',
  });
});

test('it applies overrides to the implementor started event', () => {
  const event = buildImplementorStartedEvent({ sessionID: 'session-custom' });

  expect(event).toMatchObject({ sessionID: 'session-custom' });
});
