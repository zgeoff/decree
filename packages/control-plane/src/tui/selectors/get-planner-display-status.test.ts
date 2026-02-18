import { expect, test } from 'vitest';
import type { EngineState, PlannerRun } from '../../engine/state-store/types.ts';
import { getPlannerDisplayStatus } from './get-planner-display-status.ts';

function buildEngineState(overrides?: Partial<EngineState>): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
    ...overrides,
  };
}

test('it returns idle when no planner run exists', () => {
  const state = buildEngineState();
  expect(getPlannerDisplayStatus(state)).toBe('idle');
});

test('it returns running when an active planner run exists with running status', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'running',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  expect(getPlannerDisplayStatus(state)).toBe('running');
});

test('it returns running when an active planner run exists with requested status', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'requested',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  expect(getPlannerDisplayStatus(state)).toBe('running');
});

test('it returns idle when planner run has completed status', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'completed',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  expect(getPlannerDisplayStatus(state)).toBe('idle');
});

test('it returns idle when planner run has failed status', () => {
  const plannerRun: PlannerRun = {
    role: 'planner',
    sessionID: 'planner-sess',
    status: 'failed',
    specPaths: ['spec.md'],
    logFilePath: null,
    startedAt: '2026-02-01T00:00:00Z',
  };

  const state = buildEngineState({
    agentRuns: new Map([['planner-sess', plannerRun]]),
  });

  expect(getPlannerDisplayStatus(state)).toBe('idle');
});
