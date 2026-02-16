import { expect, test } from 'vitest';
import { buildPlannerFailedEvent } from './build-planner-failed-event.ts';

test('it returns a planner failed event with default values', () => {
  const event = buildPlannerFailedEvent();

  expect(event).toStrictEqual({
    type: 'plannerFailed',
    specPaths: ['docs/specs/a.md'],
    sessionID: 'session-planner-1',
    error: 'Planner crashed',
    logFilePath: '/logs/planner.log',
  });
});

test('it applies overrides to the planner failed event', () => {
  const event = buildPlannerFailedEvent({ error: 'Custom error' });

  expect(event).toMatchObject({ error: 'Custom error' });
});
