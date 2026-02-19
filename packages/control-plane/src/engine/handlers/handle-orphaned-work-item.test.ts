import { expect, test } from 'vitest';
import { buildImplementorStartedEvent } from '../../test-utils/build-implementor-started-event.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { AgentRun, EngineState, ImplementorRun, ReviewerRun } from '../state-store/types.ts';
import { handleOrphanedWorkItem } from './handle-orphaned-work-item.ts';

function buildImplementorRun(
  overrides: Partial<ImplementorRun> & { sessionID: string },
): ImplementorRun {
  return {
    role: 'implementor',
    status: 'running',
    workItemID: 'wi-1',
    branchName: 'feat/test',
    logFilePath: null,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildReviewerRun(overrides: Partial<ReviewerRun> & { sessionID: string }): ReviewerRun {
  return {
    role: 'reviewer',
    status: 'running',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    logFilePath: null,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setupTest(agentRuns: AgentRun[] = []): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(agentRuns.map((r) => [r.sessionID, r])),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it resets an in-progress work item to pending when no agent run is active', () => {
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  });
  const state = setupTest();

  const commands = handleOrphanedWorkItem(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-1', newStatus: 'pending' },
  ]);
});

test('it returns no commands when an in-progress work item has an active agent run', () => {
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  });
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'running',
  });
  const state = setupTest([run]);

  const commands = handleOrphanedWorkItem(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when an in-progress work item has a requested agent run', () => {
  const event = buildWorkItemChangedUpsert({
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  });
  const run = buildReviewerRun({
    sessionID: 'session-1',
    workItemID: 'wi-1',
    status: 'requested',
  });
  const state = setupTest([run]);

  const commands = handleOrphanedWorkItem(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when status is not in-progress', () => {
  const event = buildWorkItemChangedUpsert({ newStatus: 'pending' });
  const state = setupTest();

  const commands = handleOrphanedWorkItem(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for a non-work-item-changed event', () => {
  const event = buildImplementorStartedEvent();
  const state = setupTest();

  const commands = handleOrphanedWorkItem(event, state);

  expect(commands).toStrictEqual([]);
});
