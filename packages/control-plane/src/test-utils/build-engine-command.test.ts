import { expect, test } from 'vitest';
import { buildEngineCommand } from './build-engine-command.ts';

test('it returns an engine command with default values', () => {
  const command = buildEngineCommand();

  expect(command).toStrictEqual({
    command: 'createWorkItem',
    title: 'Test work item',
    body: 'Test body',
    labels: [],
    blockedBy: [],
  });
});

test('it applies overrides to the engine command', () => {
  const command = buildEngineCommand({ title: 'Custom title' });

  expect(command).toMatchObject({ title: 'Custom title' });
});
