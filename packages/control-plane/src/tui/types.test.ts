import { expect, test } from 'vitest';
import type {
  AgentRun,
  ImplementorRun,
  ReviewerRun,
  WorkItem,
} from '../engine/state-store/types.ts';
import { deriveDisplayStatus } from './types.ts';

function buildWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '123',
    title: 'Test work item',
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-02-19T00:00:00Z',
    linkedRevision: null,
    ...overrides,
  };
}

function buildImplementorRun(overrides: Partial<ImplementorRun> = {}): ImplementorRun {
  return {
    role: 'implementor',
    sessionID: 'session-1',
    status: 'requested',
    workItemID: '123',
    branchName: 'task/123',
    logFilePath: null,
    startedAt: '2026-02-19T00:00:00Z',
    ...overrides,
  };
}

function buildReviewerRun(overrides: Partial<ReviewerRun> = {}): ReviewerRun {
  return {
    role: 'reviewer',
    sessionID: 'session-1',
    status: 'requested',
    workItemID: '123',
    revisionID: 'pr-1',
    logFilePath: null,
    startedAt: '2026-02-19T00:00:00Z',
    ...overrides,
  };
}

test('it returns implementing when an implementor run is requested', () => {
  const workItem = buildWorkItem({ status: 'pending' });
  const runs = [buildImplementorRun({ status: 'requested' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it returns implementing when an implementor run is running', () => {
  const workItem = buildWorkItem({ status: 'pending' });
  const runs = [buildImplementorRun({ status: 'running' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it returns reviewing when a reviewer run is requested', () => {
  const workItem = buildWorkItem({ status: 'review' });
  const runs = [buildReviewerRun({ status: 'requested' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('reviewing');
});

test('it returns reviewing when a reviewer run is running', () => {
  const workItem = buildWorkItem({ status: 'review' });
  const runs = [buildReviewerRun({ status: 'running' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('reviewing');
});

test('it returns failed when the latest implementor run failed', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [buildImplementorRun({ status: 'failed' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it returns failed when the latest implementor run timed out', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [buildImplementorRun({ status: 'timed-out' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it returns failed when the latest reviewer run failed', () => {
  const workItem = buildWorkItem({ status: 'review' });
  const runs = [buildReviewerRun({ status: 'failed' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it returns failed when the latest reviewer run timed out', () => {
  const workItem = buildWorkItem({ status: 'review' });
  const runs = [buildReviewerRun({ status: 'timed-out' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it returns implementing when a new run is requested after a failed run', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [
    buildImplementorRun({
      status: 'failed',
      startedAt: '2026-02-19T00:00:00Z',
    }),
    buildImplementorRun({
      sessionID: 'session-2',
      status: 'requested',
      startedAt: '2026-02-19T01:00:00Z',
    }),
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it returns implementing when a new run is running after a failed run', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [
    buildImplementorRun({
      status: 'failed',
      startedAt: '2026-02-19T00:00:00Z',
    }),
    buildImplementorRun({
      sessionID: 'session-2',
      status: 'running',
      startedAt: '2026-02-19T01:00:00Z',
    }),
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it returns null when work item status is closed', () => {
  const workItem = buildWorkItem({ status: 'closed' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe(null);
});

test('it returns dispatch when work item status is ready', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('dispatch');
});

test('it returns pending when work item status is pending', () => {
  const workItem = buildWorkItem({ status: 'pending' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('pending');
});

test('it returns implementing when work item status is in-progress', () => {
  const workItem = buildWorkItem({ status: 'in-progress' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it returns reviewing when work item status is review', () => {
  const workItem = buildWorkItem({ status: 'review' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('reviewing');
});

test('it returns approved when work item status is approved', () => {
  const workItem = buildWorkItem({ status: 'approved' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('approved');
});

test('it returns needs-refinement when work item status is needs-refinement', () => {
  const workItem = buildWorkItem({ status: 'needs-refinement' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('needs-refinement');
});

test('it returns blocked when work item status is blocked', () => {
  const workItem = buildWorkItem({ status: 'blocked' });
  const runs: AgentRun[] = [];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('blocked');
});

test('it returns dispatch when a cancelled run is the latest and status is ready', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [buildImplementorRun({ status: 'cancelled' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('dispatch');
});

test('it returns pending when a cancelled run is the latest and status is pending', () => {
  const workItem = buildWorkItem({ status: 'pending' });
  const runs = [buildImplementorRun({ status: 'cancelled' })];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('pending');
});

test('it returns failed when a completed run is followed by a failed run', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [
    buildImplementorRun({
      status: 'completed',
      startedAt: '2026-02-19T00:00:00Z',
    }),
    buildImplementorRun({
      sessionID: 'session-2',
      status: 'failed',
      startedAt: '2026-02-19T01:00:00Z',
    }),
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it uses the most recent run by startedAt timestamp', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs = [
    buildImplementorRun({
      status: 'failed',
      startedAt: '2026-02-19T02:00:00Z',
    }),
    buildImplementorRun({
      sessionID: 'session-2',
      status: 'running',
      startedAt: '2026-02-19T03:00:00Z',
    }),
    buildImplementorRun({
      sessionID: 'session-3',
      status: 'completed',
      startedAt: '2026-02-19T01:00:00Z',
    }),
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});

test('it ignores planner runs when determining latest run', () => {
  const workItem = buildWorkItem({ status: 'ready' });
  const runs: AgentRun[] = [
    buildImplementorRun({
      status: 'failed',
      startedAt: '2026-02-19T01:00:00Z',
    }),
    {
      role: 'planner',
      sessionID: 'planner-session',
      status: 'running',
      specPaths: ['docs/specs/foo.md'],
      logFilePath: null,
      startedAt: '2026-02-19T02:00:00Z',
    },
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('failed');
});

test('it returns implementing when reviewer run is followed by implementor run', () => {
  const workItem = buildWorkItem({ status: 'in-progress' });
  const runs: AgentRun[] = [
    buildReviewerRun({
      status: 'completed',
      startedAt: '2026-02-19T01:00:00Z',
    }),
    buildImplementorRun({
      status: 'running',
      startedAt: '2026-02-19T02:00:00Z',
    }),
  ];

  const result = deriveDisplayStatus(workItem, runs);

  expect(result).toBe('implementing');
});
