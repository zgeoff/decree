import { expect, test } from 'vitest';
import type { EngineCommand } from '../state-store/domain-type-stubs.ts';
import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  PlannerRun,
  ReviewerRun,
} from '../state-store/types.ts';
import { checkConcurrencyGuards } from './check-concurrency-guards.ts';

function buildPlannerRun(overrides: Partial<PlannerRun> & { sessionID: string }): PlannerRun {
  return {
    role: 'planner',
    status: 'running',
    specPaths: ['docs/specs/test.md'],
    logFilePath: null,
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
    branchName: 'decree/wi-1',
    logFilePath: null,
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

test('it rejects planner run request when a running planner run exists', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'running' });
  const state = setupTest([run]);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: false, reason: 'planner already running' });
});

test('it rejects planner run request when a requested planner run exists', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'requested' });
  const state = setupTest([run]);
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['docs/specs/a.md'] };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: false, reason: 'planner already running' });
});

test('it rejects implementor run request when an active implementor run exists for the work item', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-A',
    status: 'running',
  });
  const state = setupTest([run]);
  const command: EngineCommand = { command: 'requestImplementorRun', workItemID: 'wi-A' };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: false, reason: 'agent already running for work item' });
});

test('it rejects implementor run request when an active reviewer run exists for the work item', () => {
  const run = buildReviewerRun({
    sessionID: 'session-1',
    workItemID: 'wi-A',
    status: 'running',
  });
  const state = setupTest([run]);
  const command: EngineCommand = { command: 'requestImplementorRun', workItemID: 'wi-A' };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: false, reason: 'agent already running for work item' });
});

test('it allows implementor run request when no active agent run exists for the work item', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-A',
    status: 'completed',
  });
  const state = setupTest([run]);
  const command: EngineCommand = { command: 'requestImplementorRun', workItemID: 'wi-B' };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});

test('it rejects reviewer run request when an active agent run exists for the work item', () => {
  const run = buildImplementorRun({
    sessionID: 'session-1',
    workItemID: 'wi-A',
    status: 'running',
  });
  const state = setupTest([run]);
  const command: EngineCommand = {
    command: 'requestReviewerRun',
    workItemID: 'wi-A',
    revisionID: 'rev-1',
  };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: false, reason: 'agent already running for work item' });
});

test('it allows commands with no concurrency guard', () => {
  const run = buildPlannerRun({ sessionID: 'session-1', status: 'running' });
  const state = setupTest([run]);
  const command: EngineCommand = {
    command: 'transitionWorkItemStatus',
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  };

  const result = checkConcurrencyGuards(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});
