import { expect, test } from 'vitest';
import { defaultPolicy } from './default-policy.ts';
import type { EngineCommand } from './state-store/domain-type-stubs.ts';
import type { EngineState } from './state-store/types.ts';

interface SetupTestResult {
  state: EngineState;
}

function setupTest(): SetupTestResult {
  const state: EngineState = {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };

  return { state };
}

test('it allows all commands', () => {
  const { state } = setupTest();
  const command: EngineCommand = {
    command: 'transitionWorkItemStatus',
    workItemID: '1',
    newStatus: 'in-progress',
  };

  const result = defaultPolicy(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});

test('it allows request planner run commands', () => {
  const { state } = setupTest();
  const command: EngineCommand = { command: 'requestPlannerRun', specPaths: ['spec.md'] };

  const result = defaultPolicy(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});

test('it allows request implementor run commands', () => {
  const { state } = setupTest();
  const command: EngineCommand = { command: 'requestImplementorRun', workItemID: '1' };

  const result = defaultPolicy(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});

test('it allows cancel commands', () => {
  const { state } = setupTest();
  const command: EngineCommand = { command: 'cancelImplementorRun', workItemID: '1' };

  const result = defaultPolicy(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});

test('it allows create work item commands', () => {
  const { state } = setupTest();
  const command: EngineCommand = {
    command: 'createWorkItem',
    title: 'New task',
    body: 'Description',
    labels: ['task:implement'],
    blockedBy: [],
  };

  const result = defaultPolicy(command, state);

  expect(result).toStrictEqual({ allowed: true, reason: null });
});
