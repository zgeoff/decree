import { expect, test } from 'vitest';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  PlannerRun,
  ReviewerRun,
  UserCancelledRun,
  UserRequestedImplementorRun,
  UserTransitionedStatus,
} from '../state-store/types.ts';
import { handleUserDispatch } from './handle-user-dispatch.ts';

function buildPlannerRun(overrides: Partial<PlannerRun> & { sessionID: string }): PlannerRun {
  return {
    role: 'planner',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
    error: null,
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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

function buildUserRequestedImplementorRun(
  overrides?: Partial<UserRequestedImplementorRun>,
): UserRequestedImplementorRun {
  return {
    type: 'userRequestedImplementorRun',
    workItemID: 'wi-1',
    ...overrides,
  };
}

function buildUserCancelledRun(overrides?: Partial<UserCancelledRun>): UserCancelledRun {
  return {
    type: 'userCancelledRun',
    sessionID: 'session-1',
    ...overrides,
  };
}

function buildUserTransitionedStatus(
  overrides?: Partial<UserTransitionedStatus>,
): UserTransitionedStatus {
  return {
    type: 'userTransitionedStatus',
    workItemID: 'wi-1',
    newStatus: 'pending',
    ...overrides,
  };
}

test('it emits a request to run the implementor when the user requests it', () => {
  const event = buildUserRequestedImplementorRun({ workItemID: 'wi-42' });
  const state = setupTest();

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([{ command: 'requestImplementorRun', workItemID: 'wi-42' }]);
});

test('it emits a cancel planner command when the cancelled session is a planner run', () => {
  const run = buildPlannerRun({ sessionID: 'session-planner' });
  const event = buildUserCancelledRun({ sessionID: 'session-planner' });
  const state = setupTest([run]);

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([{ command: 'cancelPlannerRun' }]);
});

test('it emits a cancel implementor command when the cancelled session is an implementor run', () => {
  const run = buildImplementorRun({ sessionID: 'session-impl', workItemID: 'wi-5' });
  const event = buildUserCancelledRun({ sessionID: 'session-impl' });
  const state = setupTest([run]);

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([{ command: 'cancelImplementorRun', workItemID: 'wi-5' }]);
});

test('it emits a cancel reviewer command when the cancelled session is a reviewer run', () => {
  const run = buildReviewerRun({ sessionID: 'session-rev', workItemID: 'wi-7' });
  const event = buildUserCancelledRun({ sessionID: 'session-rev' });
  const state = setupTest([run]);

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([{ command: 'cancelReviewerRun', workItemID: 'wi-7' }]);
});

test('it returns no commands when the cancelled session is not found in agent runs', () => {
  const event = buildUserCancelledRun({ sessionID: 'nonexistent-session' });
  const state = setupTest();

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([]);
});

test('it emits a status transition when the user transitions a work item status', () => {
  const event = buildUserTransitionedStatus({ workItemID: 'wi-10', newStatus: 'closed' });
  const state = setupTest();

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-10', newStatus: 'closed' },
  ]);
});

test('it returns no commands for unrelated event types', () => {
  const event = buildWorkItemChangedUpsert();
  const state = setupTest();

  const commands = handleUserDispatch(event, state);

  expect(commands).toStrictEqual([]);
});
