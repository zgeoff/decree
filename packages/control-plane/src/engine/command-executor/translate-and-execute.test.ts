import { expect, test, vi } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import type {
  AgentReview,
  EngineCommand,
  ImplementorResult,
  PlannerResult,
  ReviewerResult,
  WorkItem,
} from '../state-store/domain-type-stubs.ts';
import type { AgentRun, EngineState, PlannerRun } from '../state-store/types.ts';
import { translateAndExecute } from './translate-and-execute.ts';
import type { CommandExecutorDeps, RuntimeAdapter } from './types.ts';

function buildMockRuntimeAdapter(): RuntimeAdapter {
  return {
    startAgent: vi.fn(),
    cancelAgent: vi.fn(),
  };
}

function buildMockDeps(overrides?: Partial<CommandExecutorDeps>): CommandExecutorDeps {
  return {
    workItemWriter: {
      transitionStatus: vi.fn().mockResolvedValue(undefined),
      createWorkItem: vi.fn().mockResolvedValue(buildWorkItem({ id: 'created-wi' })),
      updateWorkItem: vi.fn().mockResolvedValue(undefined),
    },
    revisionWriter: {
      createFromPatch: vi
        .fn()
        .mockResolvedValue(buildRevision({ id: 'created-rev', workItemID: 'wi-1' })),
      updateBody: vi.fn().mockResolvedValue(undefined),
      postReview: vi.fn().mockResolvedValue('new-review-id'),
      updateReview: vi.fn().mockResolvedValue(undefined),
      postComment: vi.fn().mockResolvedValue(undefined),
    },
    runtimeAdapters: {
      planner: buildMockRuntimeAdapter(),
      implementor: buildMockRuntimeAdapter(),
      reviewer: buildMockRuntimeAdapter(),
    },
    policy: vi.fn(() => ({ allowed: true, reason: null })),
    getState: vi.fn(() => setupState()),
    enqueue: vi.fn(),
    ...overrides,
  };
}

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

function buildReview(overrides?: Partial<AgentReview>): AgentReview {
  return {
    verdict: 'approve',
    summary: 'Looks good',
    comments: [],
    ...overrides,
  };
}

function setupState(config?: {
  workItems?: [string, WorkItem][];
  agentRuns?: AgentRun[];
  revisions?: [string, ReturnType<typeof buildRevision>][];
}): EngineState {
  return {
    workItems: new Map(config?.workItems ?? []),
    revisions: new Map(config?.revisions ?? []),
    specs: new Map(),
    agentRuns: new Map((config?.agentRuns ?? []).map((r) => [r.sessionID, r])),
    errors: [],
    lastPlannedSHAs: new Map(),
  };
}

function noopStartAgentAsync(): void {
  // intentionally empty — tests that don't exercise agent start use this no-op
}

// --- TransitionWorkItemStatus ---

test('it transitions a work item status and returns a work item changed event', async () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'ready' });
  const state = setupState({ workItems: [['wi-1', workItem]] });
  const deps = buildMockDeps();
  const command: EngineCommand = {
    command: 'transitionWorkItemStatus',
    workItemID: 'wi-1',
    newStatus: 'in-progress',
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([
    {
      type: 'workItemChanged',
      workItemID: 'wi-1',
      workItem: { ...workItem, status: 'in-progress' },
      title: workItem.title,
      oldStatus: 'ready',
      newStatus: 'in-progress',
      priority: null,
    },
  ]);
  expect(deps.workItemWriter.transitionStatus).toHaveBeenCalledWith('wi-1', 'in-progress');
});

// --- CreateWorkItem ---

test('it creates a work item and returns a work item changed event with null old status', async () => {
  const createdWorkItem = buildWorkItem({ id: 'new-wi', title: 'New task', status: 'pending' });
  const deps = buildMockDeps();
  vi.mocked(deps.workItemWriter.createWorkItem).mockResolvedValue(createdWorkItem);
  const state = setupState();
  const command: EngineCommand = {
    command: 'createWorkItem',
    title: 'New task',
    body: 'Task body',
    labels: ['task:implement'],
    blockedBy: [],
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([
    {
      type: 'workItemChanged',
      workItemID: 'new-wi',
      workItem: createdWorkItem,
      title: 'New task',
      oldStatus: null,
      newStatus: 'pending',
      priority: null,
    },
  ]);
  expect(deps.workItemWriter.createWorkItem).toHaveBeenCalledWith(
    'New task',
    'Task body',
    ['task:implement'],
    [],
  );
});

// --- CreateRevisionFromPatch ---

test('it creates a revision from patch and returns a revision changed event with null old pipeline status', async () => {
  const createdRevision = buildRevision({ id: 'rev-1', workItemID: 'wi-1' });
  const deps = buildMockDeps();
  vi.mocked(deps.revisionWriter.createFromPatch).mockResolvedValue(createdRevision);
  const state = setupState();
  const command: EngineCommand = {
    command: 'createRevisionFromPatch',
    workItemID: 'wi-1',
    patch: 'diff --git a/file.ts',
    branchName: 'decree/wi-1',
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([
    {
      type: 'revisionChanged',
      revisionID: 'rev-1',
      workItemID: 'wi-1',
      revision: createdRevision,
      oldPipelineStatus: null,
      newPipelineStatus: null,
    },
  ]);
});

// --- UpdateWorkItem ---

test('it updates a work item and returns no events', async () => {
  const deps = buildMockDeps();
  const state = setupState();
  const command: EngineCommand = {
    command: 'updateWorkItem',
    workItemID: 'wi-1',
    body: 'Updated body',
    labels: ['task:implement'],
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.workItemWriter.updateWorkItem).toHaveBeenCalledWith('wi-1', 'Updated body', [
    'task:implement',
  ]);
});

// --- CommentOnRevision ---

test('it comments on a revision and returns no events', async () => {
  const deps = buildMockDeps();
  const state = setupState();
  const command: EngineCommand = {
    command: 'commentOnRevision',
    revisionID: 'rev-1',
    body: 'Comment text',
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.revisionWriter.postComment).toHaveBeenCalledWith('rev-1', 'Comment text');
});

// --- UpdateRevisionReview ---

test('it updates a revision review when the revision has an existing review', async () => {
  const revision = buildRevision({ id: 'rev-1', reviewID: '99' });
  const state = setupState({ revisions: [['rev-1', revision]] });
  const deps = buildMockDeps();
  const review = buildReview();
  const command: EngineCommand = {
    command: 'updateRevisionReview',
    revisionID: 'rev-1',
    review,
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.revisionWriter.updateReview).toHaveBeenCalledWith('rev-1', '99', review);
});

test('it throws when updating a revision review and the revision has no review', async () => {
  const revision = buildRevision({ id: 'rev-1', reviewID: null });
  const state = setupState({ revisions: [['rev-1', revision]] });
  const deps = buildMockDeps();
  const command: EngineCommand = {
    command: 'updateRevisionReview',
    revisionID: 'rev-1',
    review: buildReview(),
  };

  await expect(translateAndExecute(command, state, deps, noopStartAgentAsync)).rejects.toThrow();
});

test('it throws when updating a revision review and the revision is not in state', async () => {
  const state = setupState();
  const deps = buildMockDeps();
  const command: EngineCommand = {
    command: 'updateRevisionReview',
    revisionID: 'rev-missing',
    review: buildReview(),
  };

  await expect(translateAndExecute(command, state, deps, noopStartAgentAsync)).rejects.toThrow();
});

// --- RequestPlannerRun ---

test('it requests a planner run and returns a planner requested event with a session identifier', async () => {
  const deps = buildMockDeps();
  const state = setupState();
  const startAgentAsync = vi.fn();
  const command: EngineCommand = {
    command: 'requestPlannerRun',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
  };

  const events = await translateAndExecute(command, state, deps, startAgentAsync);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'plannerRequested',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
  });
  expect(events[0]).toMatchObject({ sessionID: expect.any(String) });
  expect(startAgentAsync).toHaveBeenCalledWith('planner', expect.any(String), {
    role: 'planner',
    specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
  });
});

// --- RequestImplementorRun ---

test('it requests an implementor run and returns an implementor requested event with generated branch name', async () => {
  const deps = buildMockDeps();
  const state = setupState();
  const startAgentAsync = vi.fn();
  const command: EngineCommand = {
    command: 'requestImplementorRun',
    workItemID: 'wi-42',
  };

  const events = await translateAndExecute(command, state, deps, startAgentAsync);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'implementorRequested',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  });
  expect(events[0]).toMatchObject({ sessionID: expect.any(String) });
  expect(startAgentAsync).toHaveBeenCalledWith('implementor', expect.any(String), {
    role: 'implementor',
    workItemID: 'wi-42',
    branchName: 'decree/wi-42',
  });
});

// --- CancelPlannerRun ---

test('it cancels a planner run when an active planner run exists', async () => {
  const run = buildPlannerRun({ sessionID: 'session-planner', status: 'running' });
  const state = setupState({ agentRuns: [run] });
  const deps = buildMockDeps();
  const command: EngineCommand = { command: 'cancelPlannerRun' };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.runtimeAdapters.planner.cancelAgent).toHaveBeenCalledWith('session-planner');
});

test('it does nothing when cancelling a planner run with no active planner run', async () => {
  const state = setupState();
  const deps = buildMockDeps();
  const command: EngineCommand = { command: 'cancelPlannerRun' };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.runtimeAdapters.planner.cancelAgent).not.toHaveBeenCalled();
});

// --- CancelImplementorRun ---

test('it does nothing when cancelling an implementor run with no active agent', async () => {
  const state = setupState();
  const deps = buildMockDeps();
  const command: EngineCommand = { command: 'cancelImplementorRun', workItemID: 'wi-1' };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([]);
  expect(deps.runtimeAdapters.implementor.cancelAgent).not.toHaveBeenCalled();
});

// --- ApplyPlannerResult: tempID resolution ---

test('it resolves temp identifiers when second create references first create in blocked-by', async () => {
  const deps = buildMockDeps();
  let callCount = 0;
  vi.mocked(deps.workItemWriter.createWorkItem).mockImplementation(async () => {
    callCount += 1;
    return buildWorkItem({ id: `real-${callCount}`, status: 'pending' });
  });
  const state = setupState();
  const plannerResult: PlannerResult = {
    role: 'planner',
    create: [
      { tempID: 'temp-1', title: 'First', body: 'Body 1', labels: [], blockedBy: [] },
      { tempID: 'temp-2', title: 'Second', body: 'Body 2', labels: [], blockedBy: ['temp-1'] },
    ],
    close: [],
    update: [],
  };
  const command: EngineCommand = { command: 'applyPlannerResult', result: plannerResult };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toHaveLength(2);
  expect(deps.workItemWriter.createWorkItem).toHaveBeenNthCalledWith(
    2,
    'Second',
    'Body 2',
    [],
    ['real-1'],
  );
});

// --- ApplyPlannerResult: create, close, update ordering ---

test('it processes creates then closes then updates and returns correct events', async () => {
  const existingWorkItem = buildWorkItem({ id: 'wi-existing', status: 'ready' });
  let callCount = 0;
  const deps = buildMockDeps();
  vi.mocked(deps.workItemWriter.createWorkItem).mockImplementation(async () => {
    callCount += 1;
    return buildWorkItem({ id: `created-${callCount}`, status: 'pending' });
  });
  const state = setupState({ workItems: [['wi-existing', existingWorkItem]] });
  const plannerResult: PlannerResult = {
    role: 'planner',
    create: [{ tempID: 'temp-1', title: 'New', body: 'Body', labels: [], blockedBy: [] }],
    close: ['wi-existing'],
    update: [{ workItemID: 'wi-existing', body: 'Updated', labels: null }],
  };
  const command: EngineCommand = { command: 'applyPlannerResult', result: plannerResult };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    oldStatus: null,
    newStatus: 'pending',
  });
  expect(events[1]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-existing',
    oldStatus: 'ready',
    newStatus: 'closed',
  });
  expect(deps.workItemWriter.updateWorkItem).toHaveBeenCalledWith('wi-existing', 'Updated', null);
});

// --- ApplyPlannerResult: second create fails ---

test('it propagates the error when the second create fails in a planner result', async () => {
  const deps = buildMockDeps();
  let callCount = 0;
  vi.mocked(deps.workItemWriter.createWorkItem).mockImplementation(async () => {
    callCount += 1;
    if (callCount === 2) {
      throw new Error('Provider error');
    }
    return buildWorkItem({ id: `real-${callCount}`, status: 'pending' });
  });
  const state = setupState();
  const plannerResult: PlannerResult = {
    role: 'planner',
    create: [
      { tempID: 'temp-1', title: 'First', body: 'Body', labels: [], blockedBy: [] },
      { tempID: 'temp-2', title: 'Second', body: 'Body', labels: [], blockedBy: [] },
    ],
    close: [],
    update: [],
  };
  const command: EngineCommand = { command: 'applyPlannerResult', result: plannerResult };

  await expect(translateAndExecute(command, state, deps, noopStartAgentAsync)).rejects.toThrow(
    'Provider error',
  );
});

// --- ApplyImplementorResult: completed ---

test('it creates a revision and transitions status when implementor completes', async () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'in-progress' });
  const createdRevision = buildRevision({ id: 'rev-new', workItemID: 'wi-1' });
  const state = setupState({
    workItems: [['wi-1', workItem]],
  });
  const deps = buildMockDeps();
  vi.mocked(deps.revisionWriter.createFromPatch).mockResolvedValue(createdRevision);
  const implResult: ImplementorResult = {
    role: 'implementor',
    outcome: 'completed',
    patch: 'diff content',
    summary: 'Done',
  };
  const command: EngineCommand = {
    command: 'applyImplementorResult',
    workItemID: 'wi-1',
    branchName: 'decree/wi-1',
    result: implResult,
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    type: 'revisionChanged',
    revisionID: 'rev-new',
    workItemID: 'wi-1',
    oldPipelineStatus: null,
  });
  expect(events[1]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: 'in-progress',
    newStatus: 'review',
  });
  expect(deps.revisionWriter.createFromPatch).toHaveBeenCalledWith(
    'wi-1',
    'diff content',
    'decree/wi-1',
  );
  expect(deps.workItemWriter.transitionStatus).toHaveBeenCalledWith('wi-1', 'review');
});

// --- ApplyImplementorResult: blocked ---

test('it transitions to blocked when implementor outcome is blocked', async () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'in-progress' });
  const state = setupState({ workItems: [['wi-1', workItem]] });
  const deps = buildMockDeps();
  const implResult: ImplementorResult = {
    role: 'implementor',
    outcome: 'blocked',
    patch: null,
    summary: 'Blocked on external dep',
  };
  const command: EngineCommand = {
    command: 'applyImplementorResult',
    workItemID: 'wi-1',
    branchName: 'decree/wi-1',
    result: implResult,
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toStrictEqual([
    {
      type: 'workItemChanged',
      workItemID: 'wi-1',
      workItem: { ...workItem, status: 'blocked' },
      title: workItem.title,
      oldStatus: 'in-progress',
      newStatus: 'blocked',
      priority: null,
    },
  ]);
  expect(deps.revisionWriter.createFromPatch).not.toHaveBeenCalled();
});

// --- ApplyReviewerResult: no linked revision ---

test('it throws when applying reviewer result and the work item has no linked revision', async () => {
  const workItem = buildWorkItem({ id: 'wi-1', linkedRevision: null });
  const state = setupState({ workItems: [['wi-1', workItem]] });
  const deps = buildMockDeps();
  const reviewerResult: ReviewerResult = {
    role: 'reviewer',
    review: buildReview({ verdict: 'approve' }),
  };
  const command: EngineCommand = {
    command: 'applyReviewerResult',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
  };

  await expect(translateAndExecute(command, state, deps, noopStartAgentAsync)).rejects.toThrow();
});

// --- ApplyReviewerResult: no prior review ---

test('it posts a new review when the revision has no prior engine-posted review', async () => {
  const revision = buildRevision({ id: 'rev-1', workItemID: 'wi-1', reviewID: null });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review', linkedRevision: 'rev-1' });
  const state = setupState({
    workItems: [['wi-1', workItem]],
    revisions: [['rev-1', revision]],
  });
  const deps = buildMockDeps();
  const review = buildReview({ verdict: 'approve' });
  const reviewerResult: ReviewerResult = { role: 'reviewer', review };
  const command: EngineCommand = {
    command: 'applyReviewerResult',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
  };

  await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(deps.revisionWriter.postReview).toHaveBeenCalledWith('rev-1', review);
  expect(deps.revisionWriter.updateReview).not.toHaveBeenCalled();
});

// --- ApplyReviewerResult: existing review ---

test('it updates the existing review when the revision has a prior engine-posted review', async () => {
  const revision = buildRevision({ id: 'rev-1', workItemID: 'wi-1', reviewID: '99' });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review', linkedRevision: 'rev-1' });
  const state = setupState({
    workItems: [['wi-1', workItem]],
    revisions: [['rev-1', revision]],
  });
  const deps = buildMockDeps();
  const review = buildReview({ verdict: 'needs-changes' });
  const reviewerResult: ReviewerResult = { role: 'reviewer', review };
  const command: EngineCommand = {
    command: 'applyReviewerResult',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
  };

  await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(deps.revisionWriter.updateReview).toHaveBeenCalledWith('rev-1', '99', review);
  expect(deps.revisionWriter.postReview).not.toHaveBeenCalled();
});

// --- ApplyReviewerResult: approve verdict ---

test('it transitions to approved when reviewer verdict is approve', async () => {
  const revision = buildRevision({ id: 'rev-1', workItemID: 'wi-1', reviewID: null });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review', linkedRevision: 'rev-1' });
  const state = setupState({
    workItems: [['wi-1', workItem]],
    revisions: [['rev-1', revision]],
  });
  const deps = buildMockDeps();
  const reviewerResult: ReviewerResult = {
    role: 'reviewer',
    review: buildReview({ verdict: 'approve' }),
  };
  const command: EngineCommand = {
    command: 'applyReviewerResult',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: 'review',
    newStatus: 'approved',
  });
  expect(deps.workItemWriter.transitionStatus).toHaveBeenCalledWith('wi-1', 'approved');
});

// --- ApplyReviewerResult: needs-changes verdict ---

test('it transitions to needs-refinement when reviewer verdict is needs-changes', async () => {
  const revision = buildRevision({ id: 'rev-1', workItemID: 'wi-1', reviewID: null });
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review', linkedRevision: 'rev-1' });
  const state = setupState({
    workItems: [['wi-1', workItem]],
    revisions: [['rev-1', revision]],
  });
  const deps = buildMockDeps();
  const reviewerResult: ReviewerResult = {
    role: 'reviewer',
    review: buildReview({ verdict: 'needs-changes' }),
  };
  const command: EngineCommand = {
    command: 'applyReviewerResult',
    workItemID: 'wi-1',
    revisionID: 'rev-1',
    result: reviewerResult,
  };

  const events = await translateAndExecute(command, state, deps, noopStartAgentAsync);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'workItemChanged',
    workItemID: 'wi-1',
    oldStatus: 'review',
    newStatus: 'needs-refinement',
  });
  expect(deps.workItemWriter.transitionStatus).toHaveBeenCalledWith('wi-1', 'needs-refinement');
});
