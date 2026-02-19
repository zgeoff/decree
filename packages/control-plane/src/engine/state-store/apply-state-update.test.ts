import { expect, test, vi } from 'vitest';
import type { StoreApi } from 'zustand';
import { buildCommandFailedEvent } from '../../test-utils/build-command-failed-event.ts';
import { buildCommandRejectedEvent } from '../../test-utils/build-command-rejected-event.ts';
import { buildImplementorCompletedEvent } from '../../test-utils/build-implementor-completed-event.ts';
import { buildImplementorFailedEvent } from '../../test-utils/build-implementor-failed-event.ts';
import { buildImplementorRequestedEvent } from '../../test-utils/build-implementor-requested-event.ts';
import { buildImplementorStartedEvent } from '../../test-utils/build-implementor-started-event.ts';
import { buildPlannerCompletedEvent } from '../../test-utils/build-planner-completed-event.ts';
import { buildPlannerFailedEvent } from '../../test-utils/build-planner-failed-event.ts';
import { buildPlannerRequestedEvent } from '../../test-utils/build-planner-requested-event.ts';
import { buildPlannerStartedEvent } from '../../test-utils/build-planner-started-event.ts';
import { buildReviewerCompletedEvent } from '../../test-utils/build-reviewer-completed-event.ts';
import { buildReviewerFailedEvent } from '../../test-utils/build-reviewer-failed-event.ts';
import { buildReviewerRequestedEvent } from '../../test-utils/build-reviewer-requested-event.ts';
import { buildReviewerStartedEvent } from '../../test-utils/build-reviewer-started-event.ts';
import { buildRevisionChangedEvent } from '../../test-utils/build-revision-changed-event.ts';
import { buildSpecChangedEvent } from '../../test-utils/build-spec-changed-event.ts';
import { buildWorkItemChangedRemoval } from '../../test-utils/build-work-item-changed-removal.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import { createMockLogger } from '../../test-utils/create-mock-logger.ts';
import type { Logger } from '../create-logger.ts';
import { applyStateUpdate } from './apply-state-update.ts';
import { createEngineStore } from './create-engine-store.ts';
import type { EngineState } from './types.ts';

function setupTest(): { store: StoreApi<EngineState>; logger: Logger } {
  const store = createEngineStore();
  const { logger } = createMockLogger();
  return { store, logger };
}

// --- WorkItemChanged tests ---

test('it upserts a work item when new status is non-null', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert(), logger);

  const state = store.getState();
  expect(state.workItems.size).toBe(1);
  expect(state.workItems.get('wi-1')).toMatchObject({ id: 'wi-1', title: 'Test work item' });
});

test('it deletes a work item when new status is null', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-1' }), logger);
  expect(store.getState().workItems.size).toBe(1);

  applyStateUpdate(store, buildWorkItemChangedRemoval({ workItemID: 'wi-1' }), logger);

  const state = store.getState();
  expect(state.workItems.size).toBe(0);
  expect(state.workItems.has('wi-1')).toBe(false);
});

test('it replaces an existing work item on upsert', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert(), logger);
  applyStateUpdate(
    store,
    buildWorkItemChangedUpsert({
      workItem: {
        id: 'wi-1',
        title: 'Updated title',
        status: 'ready',
        priority: 'high',
        complexity: null,
        blockedBy: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        linkedRevision: null,
      },
      newStatus: 'ready',
    }),
    logger,
  );

  const state = store.getState();
  expect(state.workItems.size).toBe(1);
  expect(state.workItems.get('wi-1')).toMatchObject({ title: 'Updated title', status: 'ready' });
});

// --- RevisionChanged tests ---

test('it upserts a revision by revision ID', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildRevisionChangedEvent(), logger);

  const state = store.getState();
  expect(state.revisions.size).toBe(1);
  expect(state.revisions.get('rev-1')).toMatchObject({ id: 'rev-1', title: 'Test revision' });
});

test('it removes a revision when new pipeline status is null', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildRevisionChangedEvent({ newPipelineStatus: 'pending' }), logger);
  expect(store.getState().revisions.size).toBe(1);

  applyStateUpdate(store, buildRevisionChangedEvent({ newPipelineStatus: null }), logger);
  expect(store.getState().revisions.size).toBe(0);
  expect(store.getState().revisions.get('rev-1')).toBeUndefined();
});

// --- SpecChanged tests ---

test('it upserts a spec with file path, blob SHA, and frontmatter status', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildSpecChangedEvent(), logger);

  const state = store.getState();
  expect(state.specs.size).toBe(1);
  expect(state.specs.get('docs/specs/test.md')).toStrictEqual({
    filePath: 'docs/specs/test.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });
});

// --- PlannerRequested tests ---

test('it creates a planner run in requested status', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);

  const state = store.getState();
  expect(state.agentRuns.size).toBe(1);
  const run = state.agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    role: 'planner',
    sessionID: 'session-planner-1',
    status: 'requested',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    logFilePath: null,
  });
  expect(run?.startedAt).toBeDefined();
});

// --- PlannerStarted tests ---

test('it transitions a planner run to running and sets log file path', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);

  const run = store.getState().agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/planner.log',
  });
});

test('it rejects a planner started event when session ID is not found', () => {
  const { store, logger } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, buildPlannerStartedEvent({ sessionID: 'nonexistent' }), logger);

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

// --- PlannerCompleted tests ---

test('it transitions a planner run to completed and updates last planned SHAs', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(
    store,
    buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }),
    logger,
  );
  applyStateUpdate(
    store,
    buildSpecChangedEvent({ filePath: 'docs/specs/b.md', blobSHA: 'sha-b' }),
    logger,
  );
  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(store, buildPlannerCompletedEvent(), logger);

  const state = store.getState();
  const run = state.agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    status: 'completed',
    logFilePath: '/logs/planner.log',
  });
  expect(state.lastPlannedSHAs.get('docs/specs/a.md')).toBe('sha-a');
  expect(state.lastPlannedSHAs.get('docs/specs/b.md')).toBe('sha-b');
});

test('it skips spec paths not in specs map when updating last planned SHAs', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(
    store,
    buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }),
    logger,
  );
  applyStateUpdate(
    store,
    buildPlannerRequestedEvent({
      specPaths: ['docs/specs/a.md', 'docs/specs/x.md'],
    }),
    logger,
  );
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(
    store,
    buildPlannerCompletedEvent({
      specPaths: ['docs/specs/a.md', 'docs/specs/x.md'],
    }),
    logger,
  );

  const state = store.getState();
  expect(state.lastPlannedSHAs.get('docs/specs/a.md')).toBe('sha-a');
  expect(state.lastPlannedSHAs.has('docs/specs/x.md')).toBe(false);
});

// --- PlannerFailed tests ---

test('it transitions a planner run to failed and does not update last planned SHAs', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(
    store,
    buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }),
    logger,
  );
  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);

  const shasBefore = new Map(store.getState().lastPlannedSHAs);
  applyStateUpdate(store, buildPlannerFailedEvent(), logger);

  const state = store.getState();
  const run = state.agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/planner.log',
  });
  expect(state.lastPlannedSHAs).toStrictEqual(shasBefore);
});

test('it transitions a planner run to timed-out when reason is timeout', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(store, buildPlannerFailedEvent({ reason: 'timeout' }), logger);

  const run = store.getState().agentRuns.get('session-planner-1');
  expect(run).toMatchObject({ status: 'timed-out' });
});

test('it transitions a planner run to cancelled when reason is cancelled', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(store, buildPlannerFailedEvent({ reason: 'cancelled' }), logger);

  const run = store.getState().agentRuns.get('session-planner-1');
  expect(run).toMatchObject({ status: 'cancelled' });
});

test('it sets error on the planner run when a failure event is applied', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(store, buildPlannerFailedEvent({ error: 'out of memory' }), logger);

  const run = store.getState().agentRuns.get('session-planner-1');
  expect(run).toMatchObject({ error: 'out of memory' });
});

// --- ImplementorRequested tests ---

test('it creates an implementor run in requested status', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    role: 'implementor',
    sessionID: 'session-impl-1',
    status: 'requested',
    workItemID: 'wi-1',
    branchName: 'feature/wi-1',
    logFilePath: null,
  });
  expect(run?.startedAt).toBeDefined();
});

// --- ImplementorStarted tests ---

test('it transitions an implementor run to running', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/implementor.log',
  });
});

// --- ImplementorCompleted tests ---

test('it transitions an implementor run to completed', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorCompletedEvent(), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'completed',
    logFilePath: '/logs/implementor.log',
  });
});

// --- ImplementorFailed tests ---

test('it transitions an implementor run to failed', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorFailedEvent(), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/implementor.log',
  });
});

test('it transitions an implementor run to timed-out when reason is timeout', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorFailedEvent({ reason: 'timeout' }), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({ status: 'timed-out' });
});

test('it transitions an implementor run to cancelled when reason is cancelled', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorFailedEvent({ reason: 'cancelled' }), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({ status: 'cancelled' });
});

test('it sets error on the implementor run when a failure event is applied', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorFailedEvent({ error: 'segfault' }), logger);

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({ error: 'segfault' });
});

// --- ReviewerRequested tests ---

test('it creates a reviewer run in requested status', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    role: 'reviewer',
    sessionID: 'session-reviewer-1',
    status: 'requested',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    logFilePath: null,
  });
  expect(run?.startedAt).toBeDefined();
});

// --- ReviewerStarted tests ---

test('it transitions a reviewer run to running', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/reviewer.log',
  });
});

test('it ignores a reviewer started event when session ID is not found', () => {
  const { store, logger } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, buildReviewerStartedEvent({ sessionID: 'nonexistent' }), logger);

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

// --- ReviewerCompleted tests ---

test('it transitions a reviewer run to completed', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);
  applyStateUpdate(store, buildReviewerCompletedEvent(), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'completed',
    logFilePath: '/logs/reviewer.log',
  });
});

// --- ReviewerFailed tests ---

test('it transitions a reviewer run to failed', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);
  applyStateUpdate(store, buildReviewerFailedEvent(), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/reviewer.log',
  });
});

test('it transitions a reviewer run to timed-out when reason is timeout', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);
  applyStateUpdate(store, buildReviewerFailedEvent({ reason: 'timeout' }), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({ status: 'timed-out' });
});

test('it transitions a reviewer run to cancelled when reason is cancelled', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);
  applyStateUpdate(store, buildReviewerFailedEvent({ reason: 'cancelled' }), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({ status: 'cancelled' });
});

test('it sets error on the reviewer run when a failure event is applied', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent(), logger);
  applyStateUpdate(store, buildReviewerStartedEvent(), logger);
  applyStateUpdate(store, buildReviewerFailedEvent({ error: 'network timeout' }), logger);

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({ error: 'network timeout' });
});

// --- Agent lifecycle transition validation tests ---

test('it rejects a transition from completed to running', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorCompletedEvent(), logger);

  const stateBefore = store.getState();
  applyStateUpdate(store, buildImplementorStartedEvent({ sessionID: 'session-impl-1' }), logger);

  const stateAfter = store.getState();
  const run = stateAfter.agentRuns.get('session-impl-1');
  expect(run?.status).toBe('completed');
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

test('it rejects a transition from failed to running', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);
  applyStateUpdate(store, buildPlannerStartedEvent(), logger);
  applyStateUpdate(store, buildPlannerFailedEvent(), logger);

  const stateBefore = store.getState();
  applyStateUpdate(store, buildPlannerStartedEvent({ sessionID: 'session-planner-1' }), logger);

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns.get('session-planner-1')?.status).toBe('failed');
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

test('it rejects a started event when session ID is not in agent runs', () => {
  const { store, logger } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(
    store,
    buildImplementorStartedEvent({ sessionID: 'nonexistent-session' }),
    logger,
  );

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

// --- Logging tests ---

test('it logs an error when a transition targets an unknown session', () => {
  const { store } = setupTest();
  const { logger } = createMockLogger();

  applyStateUpdate(store, buildImplementorStartedEvent({ sessionID: 'nonexistent' }), logger);

  expect(logger.error).toHaveBeenCalledWith('agent run not found for transition', {
    sessionID: 'nonexistent',
    targetStatus: 'running',
  });
});

test('it logs an error when a transition is invalid', () => {
  const { store } = setupTest();
  const { logger } = createMockLogger();

  applyStateUpdate(store, buildImplementorRequestedEvent(), logger);
  applyStateUpdate(store, buildImplementorStartedEvent(), logger);
  applyStateUpdate(store, buildImplementorCompletedEvent(), logger);

  vi.mocked(logger.error).mockClear();
  applyStateUpdate(store, buildImplementorStartedEvent({ sessionID: 'session-impl-1' }), logger);

  expect(logger.error).toHaveBeenCalledWith('invalid agent run transition', {
    sessionID: 'session-impl-1',
    currentStatus: 'completed',
    targetStatus: 'running',
  });
});

test('it logs an error when planner completed targets an unknown session', () => {
  const { store } = setupTest();
  const { logger } = createMockLogger();

  applyStateUpdate(store, buildPlannerCompletedEvent({ sessionID: 'nonexistent' }), logger);

  expect(logger.error).toHaveBeenCalledWith('agent run not found for transition', {
    sessionID: 'nonexistent',
    targetStatus: 'completed',
  });
});

test('it logs an error when planner completed has an invalid transition', () => {
  const { store } = setupTest();
  const { logger } = createMockLogger();

  applyStateUpdate(store, buildPlannerRequestedEvent(), logger);

  vi.mocked(logger.error).mockClear();
  applyStateUpdate(store, buildPlannerCompletedEvent(), logger);

  expect(logger.error).toHaveBeenCalledWith('invalid agent run transition', {
    sessionID: 'session-planner-1',
    currentStatus: 'requested',
    targetStatus: 'completed',
  });
});

// --- CommandRejected tests ---

test('it appends a command rejected event to errors', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildCommandRejectedEvent(), logger);

  const state = store.getState();
  expect(state.errors).toHaveLength(1);
  expect(state.errors[0]?.event.type).toBe('commandRejected');
  expect(state.errors[0]?.timestamp).toBeDefined();
});

// --- CommandFailed tests ---

test('it appends a command failed event to errors', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildCommandFailedEvent(), logger);

  const state = store.getState();
  expect(state.errors).toHaveLength(1);
  expect(state.errors[0]?.event.type).toBe('commandFailed');
  expect(state.errors[0]?.timestamp).toBeDefined();
});

// --- Error eviction tests ---

test('it evicts the oldest error when exceeding 50 entries', () => {
  const { store, logger } = setupTest();

  for (let i = 0; i < 50; i += 1) {
    applyStateUpdate(store, buildCommandRejectedEvent({ reason: `reason-${i}` }), logger);
  }

  expect(store.getState().errors).toHaveLength(50);
  expect(store.getState().errors[0]).toMatchObject({ event: { reason: 'reason-0' } });

  applyStateUpdate(store, buildCommandRejectedEvent({ reason: 'reason-50' }), logger);

  const state = store.getState();
  expect(state.errors).toHaveLength(50);
  expect(state.errors[0]).toMatchObject({ event: { reason: 'reason-1' } });
  expect(state.errors[49]).toMatchObject({ event: { reason: 'reason-50' } });
});

// --- No-op event tests ---

test('it does not modify store for a user requested implementor run event', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert(), logger);
  const stateBefore = store.getState();

  applyStateUpdate(
    store,
    {
      type: 'userRequestedImplementorRun',
      workItemID: 'wi-1',
    },
    logger,
  );

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

test('it does not modify store for a user cancelled run event', () => {
  const { store, logger } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(
    store,
    {
      type: 'userCancelledRun',
      sessionID: 'session-1',
    },
    logger,
  );

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

test('it does not modify store for a user transitioned status event', () => {
  const { store, logger } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(
    store,
    {
      type: 'userTransitionedStatus',
      workItemID: 'wi-1',
      newStatus: 'ready',
    },
    logger,
  );

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

// --- Map immutability tests ---

test('it creates new map instances when updating work items', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-1' }), logger);
  const mapAfterFirst = store.getState().workItems;

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-2' }), logger);
  const mapAfterSecond = store.getState().workItems;

  expect(mapAfterFirst).not.toBe(mapAfterSecond);
});

test('it creates new map instances when updating agent runs', () => {
  const { store, logger } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent({ sessionID: 'sess-1' }), logger);
  const mapAfterFirst = store.getState().agentRuns;

  applyStateUpdate(store, buildPlannerRequestedEvent({ sessionID: 'sess-2' }), logger);
  const mapAfterSecond = store.getState().agentRuns;

  expect(mapAfterFirst).not.toBe(mapAfterSecond);
});
