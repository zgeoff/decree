import { expect, test } from 'vitest';
import { buildImplementorRequestedEvent } from './build-implementor-requested-event.ts';

test('it returns an implementor requested event with default values', () => {
  const event = buildImplementorRequestedEvent();

  expect(event).toStrictEqual({
    type: 'implementorRequested',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
  });
});

test('it applies overrides to the implementor requested event', () => {
  const event = buildImplementorRequestedEvent({ workItemID: 'wi-99' });

  expect(event).toMatchObject({ workItemID: 'wi-99' });
});
