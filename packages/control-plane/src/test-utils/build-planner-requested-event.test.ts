import { expect, test } from 'vitest';
import { buildPlannerRequestedEvent } from './build-planner-requested-event.ts';

test('it returns a planner requested event with default values', () => {
  const event = buildPlannerRequestedEvent();

  expect(event).toStrictEqual({
    type: 'plannerRequested',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    sessionID: 'session-planner-1',
  });
});

test('it applies overrides to the planner requested event', () => {
  const event = buildPlannerRequestedEvent({ sessionID: 'session-custom' });

  expect(event).toMatchObject({ sessionID: 'session-custom' });
});
