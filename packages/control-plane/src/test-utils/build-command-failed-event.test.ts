import { expect, test } from 'vitest';
import { buildCommandFailedEvent } from './build-command-failed-event.ts';

test('it returns a command failed event with default values', () => {
  const event = buildCommandFailedEvent();

  expect(event).toMatchObject({
    type: 'commandFailed',
    error: 'Provider call failed',
  });
  expect(event.command).toBeDefined();
});

test('it applies overrides to the command failed event', () => {
  const event = buildCommandFailedEvent({ error: 'Custom error' });

  expect(event).toMatchObject({ error: 'Custom error' });
});
