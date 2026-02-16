import { expect, test } from 'vitest';
import { buildPlannerCompletedEvent } from './build-planner-completed-event.ts';

test('it returns a planner completed event with default values', () => {
  const event = buildPlannerCompletedEvent();

  expect(event).toStrictEqual({
    type: 'plannerCompleted',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    sessionID: 'session-planner-1',
    result: { role: 'planner', create: [], close: [], update: [] },
    logFilePath: '/logs/planner.log',
  });
});

test('it applies overrides to the planner completed event', () => {
  const event = buildPlannerCompletedEvent({ sessionID: 'session-custom' });

  expect(event).toMatchObject({ sessionID: 'session-custom' });
});
