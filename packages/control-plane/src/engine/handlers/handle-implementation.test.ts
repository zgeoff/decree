import { expect, test } from 'vitest';
import { buildImplementorCompletedEvent } from '../../test-utils/build-implementor-completed-event.ts';
import { buildImplementorFailedEvent } from '../../test-utils/build-implementor-failed-event.ts';
import { buildImplementorRequestedEvent } from '../../test-utils/build-implementor-requested-event.ts';
import { buildImplementorStartedEvent } from '../../test-utils/build-implementor-started-event.ts';
import { buildRevisionChangedEvent } from '../../test-utils/build-revision-changed-event.ts';
import { buildSpecChangedEvent } from '../../test-utils/build-spec-changed-event.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { EngineState } from '../state-store/types.ts';
import { handleImplementation } from './handle-implementation.ts';

function setupTest(): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it emits a request to run the implementor when a work item becomes ready', () => {
  const state = setupTest();
  const event = buildWorkItemChangedUpsert({ newStatus: 'ready' });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([{ command: 'requestImplementorRun', workItemID: 'wi-1' }]);
});

test('it returns no commands when the work item status is not ready', () => {
  const state = setupTest();
  const event = buildWorkItemChangedUpsert({ newStatus: 'pending' });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for a work item changed to in-progress', () => {
  const state = setupTest();
  const event = buildWorkItemChangedUpsert({ newStatus: 'in-progress' });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([]);
});

test('it transitions the work item to in-progress when the implementor run is requested', () => {
  const state = setupTest();
  const event = buildImplementorRequestedEvent({ workItemID: 'wi-42' });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-42', newStatus: 'in-progress' },
  ]);
});

test('it emits the implementor result when the implementor completes', () => {
  const state = setupTest();
  const result = {
    role: 'implementor' as const,
    outcome: 'completed' as const,
    patch: 'diff',
    summary: 'Done',
  };
  const event = buildImplementorCompletedEvent({ workItemID: 'wi-5', result });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([
    { command: 'applyImplementorResult', workItemID: 'wi-5', result },
  ]);
});

test('it transitions the work item to pending when the implementor fails', () => {
  const state = setupTest();
  const event = buildImplementorFailedEvent({ workItemID: 'wi-7' });

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-7', newStatus: 'pending' },
  ]);
});

test('it returns no commands for an implementor started event', () => {
  const state = setupTest();
  const event = buildImplementorStartedEvent();

  const commands = handleImplementation(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for unrelated event types', () => {
  const state = setupTest();

  expect(handleImplementation(buildSpecChangedEvent(), state)).toStrictEqual([]);
  expect(handleImplementation(buildRevisionChangedEvent(), state)).toStrictEqual([]);
});
