import { expect, test } from 'vitest';
import type { EngineState, Revision } from '../types.ts';
import { getRevisionsByPipelineStatus } from './get-revisions-by-pipeline-status.ts';

function buildRevision(overrides: Partial<Revision> & { id: string }): Revision {
  return {
    title: 'Test Revision',
    url: 'https://github.com/test/repo/pull/1',
    headSHA: 'abc123',
    headRef: 'feat/test',
    author: 'test-user',
    body: 'Test body',
    isDraft: false,
    workItemID: null,
    pipeline: null,
    reviewID: null,
    ...overrides,
  };
}

function setupTest(revisions: Revision[] = []): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(revisions.map((r) => [r.id, r])),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

test('it returns revisions with matching pipeline status', () => {
  const successRevision = buildRevision({
    id: 'rev-1',
    pipeline: { status: 'success', url: null, reason: null },
  });
  const failureRevision = buildRevision({
    id: 'rev-2',
    pipeline: { status: 'failure', url: null, reason: null },
  });
  const state = setupTest([successRevision, failureRevision]);

  const result = getRevisionsByPipelineStatus(state, 'success');

  expect(result).toStrictEqual([successRevision]);
});

test('it excludes revisions with null pipeline', () => {
  const noPipeline = buildRevision({ id: 'rev-1', pipeline: null });
  const withPipeline = buildRevision({
    id: 'rev-2',
    pipeline: { status: 'pending', url: null, reason: null },
  });
  const state = setupTest([noPipeline, withPipeline]);

  const result = getRevisionsByPipelineStatus(state, 'pending');

  expect(result).toStrictEqual([withPipeline]);
});

test('it returns an empty array when no revisions match the status', () => {
  const revision = buildRevision({
    id: 'rev-1',
    pipeline: { status: 'success', url: null, reason: null },
  });
  const state = setupTest([revision]);

  const result = getRevisionsByPipelineStatus(state, 'failure');

  expect(result).toStrictEqual([]);
});

test('it returns an empty array when the store has no revisions', () => {
  const state = setupTest();

  const result = getRevisionsByPipelineStatus(state, 'pending');

  expect(result).toStrictEqual([]);
});

test('it returns multiple revisions matching the same pipeline status', () => {
  const rev1 = buildRevision({
    id: 'rev-1',
    pipeline: { status: 'failure', url: null, reason: 'tests failed' },
  });
  const rev2 = buildRevision({
    id: 'rev-2',
    pipeline: { status: 'failure', url: null, reason: 'lint failed' },
  });
  const state = setupTest([rev1, rev2]);

  const result = getRevisionsByPipelineStatus(state, 'failure');

  expect(result).toStrictEqual([rev1, rev2]);
});
