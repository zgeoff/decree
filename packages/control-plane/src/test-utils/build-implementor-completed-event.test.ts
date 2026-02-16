import { expect, test } from 'vitest';
import { buildImplementorCompletedEvent } from './build-implementor-completed-event.ts';

test('it returns an implementor completed event with default values', () => {
  const event = buildImplementorCompletedEvent();

  expect(event).toStrictEqual({
    type: 'implementorCompleted',
    workItemID: 'wi-1',
    sessionID: 'session-impl-1',
    branchName: 'feature/wi-1',
    result: { role: 'implementor', outcome: 'completed', patch: 'diff', summary: 'Done' },
    logFilePath: '/logs/implementor.log',
  });
});

test('it applies overrides to the implementor completed event', () => {
  const event = buildImplementorCompletedEvent({ workItemID: 'wi-99' });

  expect(event).toMatchObject({ workItemID: 'wi-99' });
});
