import { match } from 'ts-pattern';
import type { StoreApi } from 'zustand';
import type { Logger } from '../create-logger.ts';
import type {
  AgentRunStatus,
  CommandFailed,
  CommandRejected,
  EngineEvent,
  EngineState,
  FailureReason,
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

export function applyStateUpdate(
  store: StoreApi<EngineState>,
  event: EngineEvent,
  logger: Logger,
): void {
  match(event)
    .with({ type: 'workItemChanged' }, (e) => applyWorkItemChanged(store, e))
    .with({ type: 'revisionChanged' }, (e) => applyRevisionChanged(store, e))
    .with({ type: 'specChanged' }, (e) => applySpecChanged(store, e))
    .with({ type: 'plannerRequested' }, (e) => applyPlannerRequested(store, e))
    .with({ type: 'plannerStarted' }, (e) => applyPlannerStarted(store, e, logger))
    .with({ type: 'plannerCompleted' }, (e) => applyPlannerCompleted(store, e, logger))
    .with({ type: 'plannerFailed' }, (e) => applyPlannerFailed(store, e, logger))
    .with({ type: 'implementorRequested' }, (e) => applyImplementorRequested(store, e))
    .with({ type: 'implementorStarted' }, (e) => applyImplementorStarted(store, e, logger))
    .with({ type: 'implementorCompleted' }, (e) => applyImplementorCompleted(store, e, logger))
    .with({ type: 'implementorFailed' }, (e) => applyImplementorFailed(store, e, logger))
    .with({ type: 'reviewerRequested' }, (e) => applyReviewerRequested(store, e))
    .with({ type: 'reviewerStarted' }, (e) => applyReviewerStarted(store, e, logger))
    .with({ type: 'reviewerCompleted' }, (e) => applyReviewerCompleted(store, e, logger))
    .with({ type: 'reviewerFailed' }, (e) => applyReviewerFailed(store, e, logger))
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

  if (event.newPipelineStatus === null) {
    nextRevisions.delete(event.revisionID);
  } else {
    nextRevisions.set(event.revisionID, event.revision);
  }

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
    error: null,
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
    error: null,
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
    error: null,
    startedAt: new Date().toISOString(),
  });
  store.setState({ agentRuns: nextAgentRuns });
}

// --- Agent lifecycle: transition functions ---

function applyPlannerStarted(
  store: StoreApi<EngineState>,
  event: PlannerStarted,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: 'running',
      logFilePath: event.logFilePath,
    },
    logger,
  );
}

function applyPlannerCompleted(
  store: StoreApi<EngineState>,
  event: PlannerCompleted,
  logger: Logger,
): void {
  const state = store.getState();
  const existingRun = state.agentRuns.get(event.sessionID);

  if (!existingRun) {
    logger.error('agent run not found for transition', {
      sessionID: event.sessionID,
      targetStatus: 'completed',
    });
    return;
  }

  if (!isValidTransition(existingRun.status, 'completed')) {
    logger.error('invalid agent run transition', {
      sessionID: event.sessionID,
      currentStatus: existingRun.status,
      targetStatus: 'completed',
    });
    return;
  }

  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(event.sessionID, {
    ...existingRun,
    status: 'completed',
    logFilePath: event.logFilePath,
  });

  const nextLastPlannedSHAs = new Map(state.lastPlannedSHAs);

  for (const specPath of event.specPaths) {
    const spec = state.specs.get(specPath);
    if (spec) {
      nextLastPlannedSHAs.set(specPath, spec.blobSHA);
    }
  }

  store.setState({ agentRuns: nextAgentRuns, lastPlannedSHAs: nextLastPlannedSHAs });
}

function applyPlannerFailed(
  store: StoreApi<EngineState>,
  event: PlannerFailed,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: deriveTerminalStatus(event.reason),
      logFilePath: event.logFilePath,
      error: event.error,
    },
    logger,
  );
}

function applyImplementorStarted(
  store: StoreApi<EngineState>,
  event: ImplementorStarted,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: 'running',
      logFilePath: event.logFilePath,
    },
    logger,
  );
}

function applyImplementorCompleted(
  store: StoreApi<EngineState>,
  event: ImplementorCompleted,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: 'completed',
      logFilePath: event.logFilePath,
    },
    logger,
  );
}

function applyImplementorFailed(
  store: StoreApi<EngineState>,
  event: ImplementorFailed,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: deriveTerminalStatus(event.reason),
      logFilePath: event.logFilePath,
      error: event.error,
    },
    logger,
  );
}

function applyReviewerStarted(
  store: StoreApi<EngineState>,
  event: ReviewerStarted,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: 'running',
      logFilePath: event.logFilePath,
    },
    logger,
  );
}

function applyReviewerCompleted(
  store: StoreApi<EngineState>,
  event: ReviewerCompleted,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: 'completed',
      logFilePath: event.logFilePath,
    },
    logger,
  );
}

function applyReviewerFailed(
  store: StoreApi<EngineState>,
  event: ReviewerFailed,
  logger: Logger,
): void {
  transitionAgentRun(
    store,
    {
      sessionID: event.sessionID,
      targetStatus: deriveTerminalStatus(event.reason),
      logFilePath: event.logFilePath,
      error: event.error,
    },
    logger,
  );
}

// --- Error update functions ---

function applyCommandRejected(store: StoreApi<EngineState>, event: CommandRejected): void {
  appendError(store, event);
}

function applyCommandFailed(store: StoreApi<EngineState>, event: CommandFailed): void {
  appendError(store, event);
}

// --- Low-level helpers ---

interface AgentRunTransition {
  sessionID: string;
  targetStatus: AgentRunStatus;
  logFilePath: string | null;
  error?: string | null;
}

function transitionAgentRun(
  store: StoreApi<EngineState>,
  transition: AgentRunTransition,
  logger: Logger,
): void {
  const state = store.getState();
  const existingRun = state.agentRuns.get(transition.sessionID);

  if (!existingRun) {
    logger.error('agent run not found for transition', {
      sessionID: transition.sessionID,
      targetStatus: transition.targetStatus,
    });
    return;
  }

  if (!isValidTransition(existingRun.status, transition.targetStatus)) {
    logger.error('invalid agent run transition', {
      sessionID: transition.sessionID,
      currentStatus: existingRun.status,
      targetStatus: transition.targetStatus,
    });
    return;
  }

  const nextAgentRuns = new Map(state.agentRuns);
  nextAgentRuns.set(transition.sessionID, {
    ...existingRun,
    status: transition.targetStatus,
    logFilePath: transition.logFilePath,
    error: transition.error ?? existingRun.error,
  });
  store.setState({ agentRuns: nextAgentRuns });
}

function isValidTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

const FAILURE_REASON_TO_STATUS: Record<FailureReason, AgentRunStatus> = {
  error: 'failed',
  timeout: 'timed-out',
  cancelled: 'cancelled',
};

function deriveTerminalStatus(reason: FailureReason): AgentRunStatus {
  return FAILURE_REASON_TO_STATUS[reason];
}

function appendError(store: StoreApi<EngineState>, event: CommandRejected | CommandFailed): void {
  const state = store.getState();
  const nextErrors = [...state.errors, { event, timestamp: new Date().toISOString() }];

  if (nextErrors.length > MAX_ERRORS) {
    nextErrors.shift();
  }

  store.setState({ errors: nextErrors });
}
