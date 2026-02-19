export type {
  AgentResult,
  AgentReview,
  AgentReviewComment,
  AgentRole,
  ApplyImplementorResult,
  ApplyPlannerResult,
  ApplyReviewerResult,
  CancelImplementorRun,
  CancelPlannerRun,
  CancelReviewerRun,
  CommandFailed,
  CommandRejected,
  CommentOnRevision,
  Complexity,
  CreateRevisionFromPatch,
  CreateWorkItem,
  EngineCommand,
  EngineEvent,
  FailureReason,
  ImplementorCompleted,
  ImplementorFailed,
  ImplementorRequested,
  ImplementorResult,
  ImplementorStarted,
  // Entity types
  PipelineResult,
  PipelineStatus,
  // Agent result types
  PlannedWorkItem,
  PlannedWorkItemUpdate,
  PlannerCompleted,
  PlannerFailed,
  PlannerRequested,
  PlannerResult,
  PlannerStarted,
  PostRevisionReview,
  Priority,
  RequestImplementorRun,
  RequestPlannerRun,
  RequestReviewerRun,
  ReviewerCompleted,
  ReviewerFailed,
  ReviewerRequested,
  ReviewerResult,
  ReviewerStarted,
  ReviewHistory,
  ReviewInlineComment,
  ReviewSubmission,
  Revision,
  RevisionChanged,
  Spec,
  SpecChanged,
  SpecFrontmatterStatus,
  // Domain command types
  TransitionWorkItemStatus,
  UpdateRevision,
  UpdateRevisionReview,
  UpdateWorkItem,
  UserCancelledRun,
  UserRequestedImplementorRun,
  UserTransitionedStatus,
  WorkItem,
  // Domain event types
  WorkItemChanged,
  // Value types
  WorkItemStatus,
} from './domain-type-stubs.ts';

import type {
  CommandFailed,
  CommandRejected,
  Revision,
  Spec,
  WorkItem,
} from './domain-type-stubs.ts';

// --- AgentRunStatus ---

export type AgentRunStatus =
  | 'requested'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'cancelled';

// --- Agent run variants ---

export interface PlannerRun {
  role: 'planner';
  sessionID: string;
  status: AgentRunStatus;
  specPaths: string[];
  logFilePath: string | null;
  error: string | null;
  startedAt: string;
}

export interface ImplementorRun {
  role: 'implementor';
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  branchName: string;
  logFilePath: string | null;
  error: string | null;
  startedAt: string;
}

export interface ReviewerRun {
  role: 'reviewer';
  sessionID: string;
  status: AgentRunStatus;
  workItemID: string;
  revisionID: string;
  logFilePath: string | null;
  error: string | null;
  startedAt: string;
}

export type AgentRun = PlannerRun | ImplementorRun | ReviewerRun;

// --- ErrorEntry ---

export interface ErrorEntry {
  event: CommandRejected | CommandFailed;
  timestamp: string;
}

// --- WorkItemWithRevision ---

export interface WorkItemWithRevision {
  workItem: WorkItem;
  revision: Revision;
}

// --- EngineState ---

export interface EngineState {
  workItems: Map<string, WorkItem>;
  revisions: Map<string, Revision>;
  specs: Map<string, Spec>;
  agentRuns: Map<string, AgentRun>;
  errors: ErrorEntry[];
  lastPlannedSHAs: Map<string, string>;
}
