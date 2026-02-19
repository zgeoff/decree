import { expect, test } from 'vitest';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { EngineState } from '../state-store/types.ts';
import { createHandlers } from './create-handlers.ts';
import type { Handler } from './types.ts';

function buildState(): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

function collectCommands(
  handlers: Handler[],
  event: Parameters<Handler>[0],
  state: EngineState,
): ReturnType<Handler> {
  return handlers.flatMap((handler) => handler(event, state));
}

test('it produces the same commands regardless of handler ordering', () => {
  const handlers = createHandlers();
  const event = buildWorkItemChangedUpsert();
  const state = buildState();

  const commandsOriginal = collectCommands(handlers, event, state);

  const reversed = [...handlers].reverse();
  const commandsReversed = collectCommands(reversed, event, state);

  const sortByCommand = (commands: ReturnType<Handler>): ReturnType<Handler> =>
    [...commands].sort((a, b) => a.command.localeCompare(b.command));

  expect(sortByCommand(commandsReversed)).toStrictEqual(sortByCommand(commandsOriginal));
});
