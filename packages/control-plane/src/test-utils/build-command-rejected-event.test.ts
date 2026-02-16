import { expect, test } from 'vitest';
import { buildCommandRejectedEvent } from './build-command-rejected-event.ts';

test('it returns a command rejected event with default values', () => {
  const event = buildCommandRejectedEvent();

  expect(event).toMatchObject({
    type: 'commandRejected',
    reason: 'Concurrency guard: planner already running',
  });
  expect(event.command).toBeDefined();
});

test('it applies overrides to the command rejected event', () => {
  const event = buildCommandRejectedEvent({ reason: 'Custom reason' });

  expect(event).toMatchObject({ reason: 'Custom reason' });
});
