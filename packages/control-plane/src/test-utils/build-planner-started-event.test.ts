import { expect, test } from 'vitest';
import { buildPlannerStartedEvent } from './build-planner-started-event.ts';

test('it returns a planner started event with default values', () => {
  const event = buildPlannerStartedEvent();

  expect(event).toStrictEqual({
    type: 'plannerStarted',
    sessionID: 'session-planner-1',
    logFilePath: '/logs/planner.log',
  });
});

test('it applies overrides to the planner started event', () => {
  const event = buildPlannerStartedEvent({ logFilePath: '/custom/path.log' });

  expect(event).toMatchObject({ logFilePath: '/custom/path.log' });
});
