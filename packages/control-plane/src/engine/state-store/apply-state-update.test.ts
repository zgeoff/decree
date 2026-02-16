import { expect, test } from 'vitest';
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
import { applyStateUpdate } from './apply-state-update.ts';
import { createEngineStore } from './create-engine-store.ts';
import type { CommandRejected, EngineState } from './types.ts';

function setupTest(): { store: StoreApi<EngineState> } {
  const store = createEngineStore();
  return { store };
}

// --- WorkItemChanged tests ---

test('it upserts a work item when new status is non-null', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert());

  const state = store.getState();
  expect(state.workItems.size).toBe(1);
  expect(state.workItems.get('wi-1')).toMatchObject({ id: 'wi-1', title: 'Test work item' });
});

test('it deletes a work item when new status is null', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-1' }));
  expect(store.getState().workItems.size).toBe(1);

  applyStateUpdate(store, buildWorkItemChangedRemoval({ workItemID: 'wi-1' }));

  const state = store.getState();
  expect(state.workItems.size).toBe(0);
  expect(state.workItems.has('wi-1')).toBe(false);
});

test('it replaces an existing work item on upsert', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert());
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
  );

  const state = store.getState();
  expect(state.workItems.size).toBe(1);
  expect(state.workItems.get('wi-1')).toMatchObject({ title: 'Updated title', status: 'ready' });
});

// --- RevisionChanged tests ---

test('it upserts a revision by revision ID', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildRevisionChangedEvent());

  const state = store.getState();
  expect(state.revisions.size).toBe(1);
  expect(state.revisions.get('rev-1')).toMatchObject({ id: 'rev-1', title: 'Test revision' });
});

// --- SpecChanged tests ---

test('it upserts a spec with file path, blob SHA, and frontmatter status', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildSpecChangedEvent());

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
  const { store } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent());

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
  const { store } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent());
  applyStateUpdate(store, buildPlannerStartedEvent());

  const run = store.getState().agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/planner.log',
  });
});

test('it rejects a planner started event when session ID is not found', () => {
  const { store } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, buildPlannerStartedEvent({ sessionID: 'nonexistent' }));

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

// --- PlannerCompleted tests ---

test('it transitions a planner run to completed and updates last planned SHAs', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }));
  applyStateUpdate(store, buildSpecChangedEvent({ filePath: 'docs/specs/b.md', blobSHA: 'sha-b' }));
  applyStateUpdate(store, buildPlannerRequestedEvent());
  applyStateUpdate(store, buildPlannerStartedEvent());
  applyStateUpdate(store, buildPlannerCompletedEvent());

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
  const { store } = setupTest();

  applyStateUpdate(store, buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }));
  applyStateUpdate(
    store,
    buildPlannerRequestedEvent({
      specPaths: ['docs/specs/a.md', 'docs/specs/x.md'],
    }),
  );
  applyStateUpdate(store, buildPlannerStartedEvent());
  applyStateUpdate(
    store,
    buildPlannerCompletedEvent({
      specPaths: ['docs/specs/a.md', 'docs/specs/x.md'],
    }),
  );

  const state = store.getState();
  expect(state.lastPlannedSHAs.get('docs/specs/a.md')).toBe('sha-a');
  expect(state.lastPlannedSHAs.has('docs/specs/x.md')).toBe(false);
});

// --- PlannerFailed tests ---

test('it transitions a planner run to failed and does not update last planned SHAs', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildSpecChangedEvent({ filePath: 'docs/specs/a.md', blobSHA: 'sha-a' }));
  applyStateUpdate(store, buildPlannerRequestedEvent());
  applyStateUpdate(store, buildPlannerStartedEvent());

  const shasBefore = new Map(store.getState().lastPlannedSHAs);
  applyStateUpdate(store, buildPlannerFailedEvent());

  const state = store.getState();
  const run = state.agentRuns.get('session-planner-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/planner.log',
  });
  expect(state.lastPlannedSHAs).toStrictEqual(shasBefore);
});

// --- ImplementorRequested tests ---

test('it creates an implementor run in requested status', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent());

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
  const { store } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent());
  applyStateUpdate(store, buildImplementorStartedEvent());

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/implementor.log',
  });
});

// --- ImplementorCompleted tests ---

test('it transitions an implementor run to completed', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent());
  applyStateUpdate(store, buildImplementorStartedEvent());
  applyStateUpdate(store, buildImplementorCompletedEvent());

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'completed',
    logFilePath: '/logs/implementor.log',
  });
});

// --- ImplementorFailed tests ---

test('it transitions an implementor run to failed', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent());
  applyStateUpdate(store, buildImplementorStartedEvent());
  applyStateUpdate(store, buildImplementorFailedEvent());

  const run = store.getState().agentRuns.get('session-impl-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/implementor.log',
  });
});

// --- ReviewerRequested tests ---

test('it creates a reviewer run in requested status', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent());

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
  const { store } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent());
  applyStateUpdate(store, buildReviewerStartedEvent());

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'running',
    logFilePath: '/logs/reviewer.log',
  });
});

// --- ReviewerCompleted tests ---

test('it transitions a reviewer run to completed', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent());
  applyStateUpdate(store, buildReviewerStartedEvent());
  applyStateUpdate(store, buildReviewerCompletedEvent());

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'completed',
    logFilePath: '/logs/reviewer.log',
  });
});

// --- ReviewerFailed tests ---

test('it transitions a reviewer run to failed', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildReviewerRequestedEvent());
  applyStateUpdate(store, buildReviewerStartedEvent());
  applyStateUpdate(store, buildReviewerFailedEvent());

  const run = store.getState().agentRuns.get('session-reviewer-1');
  expect(run).toMatchObject({
    status: 'failed',
    logFilePath: '/logs/reviewer.log',
  });
});

// --- Agent lifecycle transition validation tests ---

test('it rejects a transition from completed to running', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildImplementorRequestedEvent());
  applyStateUpdate(store, buildImplementorStartedEvent());
  applyStateUpdate(store, buildImplementorCompletedEvent());

  const stateBefore = store.getState();
  applyStateUpdate(store, buildImplementorStartedEvent({ sessionID: 'session-impl-1' }));

  const stateAfter = store.getState();
  const run = stateAfter.agentRuns.get('session-impl-1');
  expect(run?.status).toBe('completed');
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

test('it rejects a transition from failed to running', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent());
  applyStateUpdate(store, buildPlannerStartedEvent());
  applyStateUpdate(store, buildPlannerFailedEvent());

  const stateBefore = store.getState();
  applyStateUpdate(store, buildPlannerStartedEvent({ sessionID: 'session-planner-1' }));

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns.get('session-planner-1')?.status).toBe('failed');
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

test('it rejects a started event when session ID is not in agent runs', () => {
  const { store } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, buildImplementorStartedEvent({ sessionID: 'nonexistent-session' }));

  const stateAfter = store.getState();
  expect(stateAfter.agentRuns).toStrictEqual(stateBefore.agentRuns);
});

// --- CommandRejected tests ---

test('it appends a command rejected event to errors', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildCommandRejectedEvent());

  const state = store.getState();
  expect(state.errors).toHaveLength(1);
  expect(state.errors[0]?.event.type).toBe('commandRejected');
  expect(state.errors[0]?.timestamp).toBeDefined();
});

// --- CommandFailed tests ---

test('it appends a command failed event to errors', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildCommandFailedEvent());

  const state = store.getState();
  expect(state.errors).toHaveLength(1);
  expect(state.errors[0]?.event.type).toBe('commandFailed');
  expect(state.errors[0]?.timestamp).toBeDefined();
});

// --- Error eviction tests ---

test('it evicts the oldest error when exceeding 50 entries', () => {
  const { store } = setupTest();

  for (let i = 0; i < 50; i += 1) {
    applyStateUpdate(store, buildCommandRejectedEvent({ reason: `reason-${i}` }));
  }

  expect(store.getState().errors).toHaveLength(50);
  const firstReason = (store.getState().errors[0]?.event as CommandRejected).reason;
  expect(firstReason).toBe('reason-0');

  applyStateUpdate(store, buildCommandRejectedEvent({ reason: 'reason-50' }));

  const state = store.getState();
  expect(state.errors).toHaveLength(50);
  const newFirstReason = (state.errors[0]?.event as CommandRejected).reason;
  expect(newFirstReason).toBe('reason-1');
  const lastReason = (state.errors[49]?.event as CommandRejected).reason;
  expect(lastReason).toBe('reason-50');
});

// --- No-op event tests ---

test('it does not modify store for a user requested implementor run event', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert());
  const stateBefore = store.getState();

  applyStateUpdate(store, {
    type: 'userRequestedImplementorRun',
    workItemID: 'wi-1',
  });

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

test('it does not modify store for a user cancelled run event', () => {
  const { store } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, {
    type: 'userCancelledRun',
    sessionID: 'session-1',
  });

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

test('it does not modify store for a user transitioned status event', () => {
  const { store } = setupTest();
  const stateBefore = store.getState();

  applyStateUpdate(store, {
    type: 'userTransitionedStatus',
    workItemID: 'wi-1',
    newStatus: 'ready',
  });

  const stateAfter = store.getState();
  expect(stateAfter).toBe(stateBefore);
});

// --- Map immutability tests ---

test('it creates new map instances when updating work items', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-1' }));
  const mapAfterFirst = store.getState().workItems;

  applyStateUpdate(store, buildWorkItemChangedUpsert({ workItemID: 'wi-2' }));
  const mapAfterSecond = store.getState().workItems;

  expect(mapAfterFirst).not.toBe(mapAfterSecond);
});

test('it creates new map instances when updating agent runs', () => {
  const { store } = setupTest();

  applyStateUpdate(store, buildPlannerRequestedEvent({ sessionID: 'sess-1' }));
  const mapAfterFirst = store.getState().agentRuns;

  applyStateUpdate(store, buildPlannerRequestedEvent({ sessionID: 'sess-2' }));
  const mapAfterSecond = store.getState().agentRuns;

  expect(mapAfterFirst).not.toBe(mapAfterSecond);
});
