import { match } from 'ts-pattern';
import type { StoreApi } from 'zustand';
import type {
  AgentRunStatus,
  CommandFailed,
  CommandRejected,
  EngineEvent,
  EngineState,
  ImplementorCompleted,
  ImplementorFailed,
  ImplementorRequested,
  ImplementorStarted,
  PlannerCompleted,
  PlannerFailed,
  PlannerRequested,
  PlannerStarted,
  ReviewerCompleted,
  ReviewerFailed,
  ReviewerRequested,
  ReviewerStarted,
  RevisionChanged,
  SpecChanged,
  WorkItemChanged,
} from './types.ts';

const MAX_ERRORS = 50;

const VALID_TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  requested: ['running', 'cancelled'],
  running: ['completed', 'failed', 'timed-out', 'cancelled'],
  completed: [],
  failed: [],
  'timed-out': [],
  cancelled: [],
};

export function applyStateUpdate(store: StoreApi<EngineState>, event: EngineEvent): void {
  match(event)
    .with({ type: 'workItemChanged' }, (e) => applyWorkItemChanged(store, e))
    .with({ type: 'revisionChanged' }, (e) => applyRevisionChanged(store, e))
    .with({ type: 'specChanged' }, (e) => applySpecChanged(store, e))
    .with({ type: 'plannerRequested' }, (e) => applyPlannerRequested(store, e))
    .with({ type: 'plannerStarted' }, (e) => applyPlannerStarted(store, e))
    .with({ type: 'plannerCompleted' }, (e) => applyPlannerCompleted(store, e))
    .with({ type: 'plannerFailed' }, (e) => applyPlannerFailed(store, e))
    .with({ type: 'implementorRequested' }, (e) => applyImplementorRequested(store, e))
    .with({ type: 'implementorStarted' }, (e) => applyImplementorStarted(store, e))
    .with({ type: 'implementorCompleted' }, (e) => applyImplementorCompleted(store, e))
    .with({ type: 'implementorFailed' }, (e) => applyImplementorFailed(store, e))
    .with({ type: 'reviewerRequested' }, (e) => applyReviewerRequested(store, e))
    .with({ type: 'reviewerStarted' }, (e) => applyReviewerStarted(store, e))
    .with({ type: 'reviewerCompleted' }, (e) => applyReviewerCompleted(store, e))
    .with({ type: 'reviewerFailed' }, (e) => applyReviewerFailed(store, e))
    .with({ type: 'commandRejected' }, (e) => applyCommandRejected(store, e))
    .with({ type: 'commandFailed' }, (e) => applyCommandFailed(store, e))
    .with({ type: 'userRequestedImplementorRun' }, () => {
      // no-op — handled only by handlers
    })
    .with({ type: 'userCancelledRun' }, () => {
      // no-op — handled only by handlers
    })
    .with({ type: 'userTransitionedStatus' }, () => {
      // no-op — handled only by handlers
    })
    .exhaustive();
}

// --- Entity update functions ---

function applyWorkItemChanged(store: StoreApi<EngineState>, event: WorkItemChanged): void {
  const state = store.getState();
  const nextWorkItems = new Map(state.workItems);

  if (event.newStatus === null) {
    nextWorkItems.delete(event.workItemID);
  } else {
    nextWorkItems.set(event.workItemID, event.workItem);
  }

  store.setState({ workItems: nextWorkItems });
}

function applyRevisionChanged(store: StoreApi<EngineState>, event: RevisionChanged): void {
  const state = store.getState();
  const nextRevisions = new Map(state.revisions);
  nextRevisions.set(event.revisionID, event.revision);
  store.setState({ revisions: nextRevisions });
}

function applySpecChanged(store: StoreApi<EngineState>, event: SpecChanged): void {
  const state = store.getState();
  const nextSpecs = new Map(state.specs);
  nextSpecs.set(event.filePath, {
    filePath: event.filePath,
    blobSHA: event.blobSHA,
    frontmatterStatus: event.frontmatterStatus,
  });
  store.setState({ specs: nextSpecs });
}

// --- Agent lifecycle: creation functions ---

function applyPlannerRequested(store: StoreApi<EngineState>, event: PlannerRequested): void {
  const state = store.getState();
  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(event.sessionID, {
    role: 'planner',
    sessionID: event.sessionID,
    status: 'requested',
    specPaths: event.specPaths,
    logFilePath: null,
    startedAt: new Date().toISOString(),
  });
  store.setState({ agentRuns: nextAgentRuns });
}

function applyImplementorRequested(
  store: StoreApi<EngineState>,
  event: ImplementorRequested,
): void {
  const state = store.getState();
  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(event.sessionID, {
    role: 'implementor',
    sessionID: event.sessionID,
    status: 'requested',
    workItemID: event.workItemID,
    branchName: event.branchName,
    logFilePath: null,
    startedAt: new Date().toISOString(),
  });
  store.setState({ agentRuns: nextAgentRuns });
}

function applyReviewerRequested(store: StoreApi<EngineState>, event: ReviewerRequested): void {
  const state = store.getState();
  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(event.sessionID, {
    role: 'reviewer',
    sessionID: event.sessionID,
    status: 'requested',
    workItemID: event.workItemID,
    revisionID: event.revisionID,
    logFilePath: null,
    startedAt: new Date().toISOString(),
  });
  store.setState({ agentRuns: nextAgentRuns });
}

// --- Agent lifecycle: transition functions ---

function applyPlannerStarted(store: StoreApi<EngineState>, event: PlannerStarted): void {
  transitionAgentRun(store, event.sessionID, 'running', event.logFilePath);
}

function applyPlannerCompleted(store: StoreApi<EngineState>, event: PlannerCompleted): void {
  const state = store.getState();
  const existingRun = state.agentRuns.get(event.sessionID);

  if (!existingRun) {
    return;
  }

  if (!isValidTransition(existingRun.status, 'completed')) {
    return;
  }

  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(event.sessionID, {
    ...existingRun,
    status: 'completed',
    logFilePath: event.logFilePath,
  });

  const nextLastPlannedSHAs = new Map(state.lastPlannedSHAs);

  if (existingRun.role === 'planner') {
    for (const specPath of existingRun.specPaths) {
      const spec = state.specs.get(specPath);
      if (spec) {
        nextLastPlannedSHAs.set(specPath, spec.blobSHA);
      }
    }
  }

  store.setState({ agentRuns: nextAgentRuns, lastPlannedSHAs: nextLastPlannedSHAs });
}

function applyPlannerFailed(store: StoreApi<EngineState>, event: PlannerFailed): void {
  transitionAgentRun(store, event.sessionID, 'failed', event.logFilePath);
}

function applyImplementorStarted(store: StoreApi<EngineState>, event: ImplementorStarted): void {
  transitionAgentRun(store, event.sessionID, 'running', event.logFilePath);
}

function applyImplementorCompleted(
  store: StoreApi<EngineState>,
  event: ImplementorCompleted,
): void {
  transitionAgentRun(store, event.sessionID, 'completed', event.logFilePath);
}

function applyImplementorFailed(store: StoreApi<EngineState>, event: ImplementorFailed): void {
  transitionAgentRun(store, event.sessionID, 'failed', event.logFilePath);
}

function applyReviewerStarted(store: StoreApi<EngineState>, event: ReviewerStarted): void {
  transitionAgentRun(store, event.sessionID, 'running', event.logFilePath);
}

function applyReviewerCompleted(store: StoreApi<EngineState>, event: ReviewerCompleted): void {
  transitionAgentRun(store, event.sessionID, 'completed', event.logFilePath);
}

function applyReviewerFailed(store: StoreApi<EngineState>, event: ReviewerFailed): void {
  transitionAgentRun(store, event.sessionID, 'failed', event.logFilePath);
}

// --- Error update functions ---

function applyCommandRejected(store: StoreApi<EngineState>, event: CommandRejected): void {
  appendError(store, event);
}

function applyCommandFailed(store: StoreApi<EngineState>, event: CommandFailed): void {
  appendError(store, event);
}

// --- Low-level helpers ---

function transitionAgentRun(
  store: StoreApi<EngineState>,
  sessionID: string,
  targetStatus: AgentRunStatus,
  logFilePath: string | null,
): void {
  const state = store.getState();
  const existingRun = state.agentRuns.get(sessionID);

  if (!existingRun) {
    return;
  }

  if (!isValidTransition(existingRun.status, targetStatus)) {
    return;
  }

  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(sessionID, {
    ...existingRun,
    status: targetStatus,
    logFilePath,
  });
  store.setState({ agentRuns: nextAgentRuns });
}

function isValidTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

function appendError(store: StoreApi<EngineState>, event: CommandRejected | CommandFailed): void {
  const state = store.getState();
  const nextErrors = [...state.errors, { event, timestamp: new Date().toISOString() }];

  if (nextErrors.length > MAX_ERRORS) {
    nextErrors.shift();
  }

  store.setState({ errors: nextErrors });
}
