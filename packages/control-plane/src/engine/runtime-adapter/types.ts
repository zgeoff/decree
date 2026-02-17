import type { RevisionProviderReader, WorkProviderReader } from '../github-provider/types.ts';
import type { AgentResult } from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';

// --- RuntimeAdapter ---

/**
 * Adapter for starting and cancelling agent runs.
 */
export interface RuntimeAdapter {
  startAgent: (params: AgentStartParams) => Promise<AgentRunHandle>;
  cancelAgent: (sessionID: string) => void;
}

/**
 * Handle returned by `RuntimeAdapter.startAgent`.
 */
export interface AgentRunHandle {
  output: AsyncIterable<string>;
  result: Promise<AgentResult>;
  logFilePath: string | null;
}

// --- AgentStartParams ---

/**
 * Start params for a planner agent run.
 */
export interface PlannerStartParams {
  role: 'planner';
  specPaths: string[];
}

/**
 * Start params for an implementor agent run.
 */
export interface ImplementorStartParams {
  role: 'implementor';
  workItemID: string;
  branchName: string;
}

/**
 * Start params for a reviewer agent run.
 */
export interface ReviewerStartParams {
  role: 'reviewer';
  workItemID: string;
  revisionID: string;
}

/**
 * Union of per-role agent start params.
 */
export type AgentStartParams = PlannerStartParams | ImplementorStartParams | ReviewerStartParams;

// --- RuntimeAdapterDeps ---

/**
 * Universal dependency interface — what the engine provides to any adapter factory.
 */
export interface RuntimeAdapterDeps {
  workItemReader: WorkProviderReader;
  revisionReader: RevisionProviderReader;
  getState: () => EngineState;
  getReviewHistory: (revisionID: string) => Promise<ReviewHistory>;
}

// --- RuntimeAdapterConfig ---

/**
 * Base configuration type with mandatory fields. Implementation configs extend this with
 * adapter-specific fields.
 */
export interface RuntimeAdapterConfig {
  maxAgentDuration: number;
  logging: {
    agentSessions: boolean;
    logsDir: string;
  };
}

// --- ReviewHistory ---

/**
 * Review history for a given revision.
 */
export interface ReviewHistory {
  reviews: ReviewSubmission[];
  inlineComments: ReviewInlineComment[];
}

/**
 * A single review submission.
 */
export interface ReviewSubmission {
  author: string;
  state: string;
  body: string;
}

/**
 * A single inline comment on a revision.
 */
export interface ReviewInlineComment {
  path: string;
  line: number | null;
  author: string;
  body: string;
}
