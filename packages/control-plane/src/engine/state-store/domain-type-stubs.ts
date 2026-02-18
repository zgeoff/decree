// TODO: Replace with imports from canonical domain types module once it exists

// --- Value types ---

export type WorkItemStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'review'
  | 'approved'
  | 'closed'
  | 'needs-refinement'
  | 'blocked';

export type Priority = 'high' | 'medium' | 'low';

export type Complexity = 'trivial' | 'low' | 'medium' | 'high';

export type SpecFrontmatterStatus = 'draft' | 'approved' | 'deprecated';

export type PipelineStatus = 'pending' | 'success' | 'failure';

export type AgentRole = 'planner' | 'implementor' | 'reviewer';

// --- Entity types ---

export interface PipelineResult {
  status: PipelineStatus;
  url: string | null;
  reason: string | null;
}

export interface WorkItem {
  id: string;
  title: string;
  status: WorkItemStatus;
  priority: Priority | null;
  complexity: Complexity | null;
  blockedBy: string[];
  createdAt: string;
  linkedRevision: string | null;
}

export interface Revision {
  id: string;
  title: string;
  url: string;
  headSHA: string;
  headRef: string;
  author: string;
  body: string;
  isDraft: boolean;
  workItemID: string | null;
  pipeline: PipelineResult | null;
  reviewID: string | null;
}

export interface Spec {
  filePath: string;
  blobSHA: string;
  frontmatterStatus: SpecFrontmatterStatus;
}

// --- Agent result types ---

export interface PlannedWorkItem {
  tempID: string;
  title: string;
  body: string;
  labels: string[];
  blockedBy: string[];
}

export interface PlannedWorkItemUpdate {
  workItemID: string;
  body: string | null;
  labels: string[] | null;
}

export interface PlannerResult {
  role: 'planner';
  create: PlannedWorkItem[];
  close: string[];
  update: PlannedWorkItemUpdate[];
}

export interface ImplementorResult {
  role: 'implementor';
  outcome: 'completed' | 'blocked' | 'validation-failure';
  patch: string | null;
  summary: string;
}

export interface AgentReviewComment {
  path: string;
  line: number | null;
  body: string;
}

export interface AgentReview {
  verdict: 'approve' | 'needs-changes';
  summary: string;
  comments: AgentReviewComment[];
}

export interface ReviewerResult {
  role: 'reviewer';
  review: AgentReview;
}

export type AgentResult = PlannerResult | ImplementorResult | ReviewerResult;

// --- Domain event types ---

export interface WorkItemChanged {
  type: 'workItemChanged';
  workItemID: string;
  workItem: WorkItem;
  title: string;
  oldStatus: WorkItemStatus | null;
  newStatus: WorkItemStatus | null;
  priority: Priority | null;
}

export interface RevisionChanged {
  type: 'revisionChanged';
  revisionID: string;
  workItemID: string | null;
  revision: Revision;
  oldPipelineStatus: PipelineStatus | null;
  newPipelineStatus: PipelineStatus | null;
}

export interface SpecChanged {
  type: 'specChanged';
  filePath: string;
  blobSHA: string;
  frontmatterStatus: SpecFrontmatterStatus;
  changeType: 'added' | 'modified';
  commitSHA: string;
}

export interface PlannerRequested {
  type: 'plannerRequested';
  specPaths: string[];
  sessionID: string;
}

export interface PlannerStarted {
  type: 'plannerStarted';
  sessionID: string;
  logFilePath: string | null;
}

export interface PlannerCompleted {
  type: 'plannerCompleted';
  specPaths: string[];
  sessionID: string;
  result: PlannerResult;
  logFilePath: string | null;
}

export interface PlannerFailed {
  type: 'plannerFailed';
  specPaths: string[];
  sessionID: string;
  error: string;
  logFilePath: string | null;
}

export interface ImplementorRequested {
  type: 'implementorRequested';
  workItemID: string;
  sessionID: string;
  branchName: string;
}

export interface ImplementorStarted {
  type: 'implementorStarted';
  sessionID: string;
  logFilePath: string | null;
}

export interface ImplementorCompleted {
  type: 'implementorCompleted';
  workItemID: string;
  sessionID: string;
  branchName: string;
  result: ImplementorResult;
  logFilePath: string | null;
}

export interface ImplementorFailed {
  type: 'implementorFailed';
  workItemID: string;
  sessionID: string;
  branchName: string;
  error: string;
  logFilePath: string | null;
}

export interface ReviewerRequested {
  type: 'reviewerRequested';
  workItemID: string;
  revisionID: string;
  sessionID: string;
}

export interface ReviewerStarted {
  type: 'reviewerStarted';
  sessionID: string;
  logFilePath: string | null;
}

export interface ReviewerCompleted {
  type: 'reviewerCompleted';
  workItemID: string;
  revisionID: string;
  sessionID: string;
  result: ReviewerResult;
  logFilePath: string | null;
}

export interface ReviewerFailed {
  type: 'reviewerFailed';
  workItemID: string;
  revisionID: string;
  sessionID: string;
  error: string;
  logFilePath: string | null;
}

export interface CommandRejected {
  type: 'commandRejected';
  command: EngineCommand;
  reason: string;
}

export interface CommandFailed {
  type: 'commandFailed';
  command: EngineCommand;
  error: string;
}

export interface UserRequestedImplementorRun {
  type: 'userRequestedImplementorRun';
  workItemID: string;
}

export interface UserCancelledRun {
  type: 'userCancelledRun';
  sessionID: string;
}

export interface UserTransitionedStatus {
  type: 'userTransitionedStatus';
  workItemID: string;
  newStatus: WorkItemStatus;
}

export type EngineEvent =
  | WorkItemChanged
  | RevisionChanged
  | SpecChanged
  | PlannerRequested
  | PlannerStarted
  | PlannerCompleted
  | PlannerFailed
  | ImplementorRequested
  | ImplementorStarted
  | ImplementorCompleted
  | ImplementorFailed
  | ReviewerRequested
  | ReviewerStarted
  | ReviewerCompleted
  | ReviewerFailed
  | CommandRejected
  | CommandFailed
  | UserRequestedImplementorRun
  | UserCancelledRun
  | UserTransitionedStatus;

// --- Domain command types ---

export interface TransitionWorkItemStatus {
  command: 'transitionWorkItemStatus';
  workItemID: string;
  newStatus: WorkItemStatus;
}

export interface CreateWorkItem {
  command: 'createWorkItem';
  title: string;
  body: string;
  labels: string[];
  blockedBy: string[];
}

export interface UpdateWorkItem {
  command: 'updateWorkItem';
  workItemID: string;
  body: string | null;
  labels: string[] | null;
}

export interface RequestPlannerRun {
  command: 'requestPlannerRun';
  specPaths: string[];
}

export interface RequestImplementorRun {
  command: 'requestImplementorRun';
  workItemID: string;
}

export interface RequestReviewerRun {
  command: 'requestReviewerRun';
  workItemID: string;
  revisionID: string;
}

export interface CancelPlannerRun {
  command: 'cancelPlannerRun';
}

export interface CancelImplementorRun {
  command: 'cancelImplementorRun';
  workItemID: string;
}

export interface CancelReviewerRun {
  command: 'cancelReviewerRun';
  workItemID: string;
}

export interface CreateRevisionFromPatch {
  command: 'createRevisionFromPatch';
  workItemID: string;
  patch: string;
  branchName: string;
}

export interface UpdateRevision {
  command: 'updateRevision';
  revisionID: string;
  body: string | null;
}

export interface PostRevisionReview {
  command: 'postRevisionReview';
  revisionID: string;
  review: AgentReview;
}

export interface UpdateRevisionReview {
  command: 'updateRevisionReview';
  revisionID: string;
  review: AgentReview;
}

export interface CommentOnRevision {
  command: 'commentOnRevision';
  revisionID: string;
  body: string;
}

export interface ApplyPlannerResult {
  command: 'applyPlannerResult';
  result: PlannerResult;
}

export interface ApplyImplementorResult {
  command: 'applyImplementorResult';
  workItemID: string;
  branchName: string;
  result: ImplementorResult;
}

export interface ApplyReviewerResult {
  command: 'applyReviewerResult';
  workItemID: string;
  revisionID: string;
  result: ReviewerResult;
}

export type EngineCommand =
  | TransitionWorkItemStatus
  | CreateWorkItem
  | UpdateWorkItem
  | RequestPlannerRun
  | RequestImplementorRun
  | RequestReviewerRun
  | CancelPlannerRun
  | CancelImplementorRun
  | CancelReviewerRun
  | CreateRevisionFromPatch
  | UpdateRevision
  | PostRevisionReview
  | UpdateRevisionReview
  | CommentOnRevision
  | ApplyPlannerResult
  | ApplyImplementorResult
  | ApplyReviewerResult;
