import type { RevisionProviderWriter, WorkProviderWriter } from '../github-provider/types.ts';
import type {
  AgentResult,
  AgentRole,
  EngineCommand,
  EngineEvent,
} from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';

// --- CommandExecutor ---

export interface CommandExecutor {
  execute: (command: EngineCommand, state: EngineState) => Promise<EngineEvent[]>;
}

export interface CommandExecutorDeps {
  workItemWriter: WorkProviderWriter;
  revisionWriter: RevisionProviderWriter;
  runtimeAdapters: Record<AgentRole, RuntimeAdapter>;
  policy: Policy;
  getState: () => EngineState;
  enqueue: (event: EngineEvent) => void;
}

// --- Policy ---

export type Policy = (command: EngineCommand, state: EngineState) => PolicyResult;

export interface PolicyResult {
  allowed: boolean;
  reason: string | null;
}

// --- Guard result ---

export interface GuardResult {
  allowed: boolean;
  reason: string | null;
}

// --- Temporarily hosted types (permanent home: engine/runtime-adapter/types.ts) ---

/**
 * Adapter for starting and cancelling agent runs.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export interface RuntimeAdapter {
  startAgent: (params: AgentStartParams) => Promise<AgentRunHandle>;
  cancelAgent: (sessionID: string) => void;
}

/**
 * Handle returned by `RuntimeAdapter.startAgent`.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export interface AgentRunHandle {
  output: AsyncIterable<string>;
  result: Promise<AgentResult>;
  logFilePath: string | null;
}

/**
 * Start params for a planner agent run.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export interface PlannerStartParams {
  role: 'planner';
  specPaths: string[];
}

/**
 * Start params for an implementor agent run.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export interface ImplementorStartParams {
  role: 'implementor';
  workItemID: string;
  branchName: string;
}

/**
 * Start params for a reviewer agent run.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export interface ReviewerStartParams {
  role: 'reviewer';
  workItemID: string;
  revisionID: string;
}

/**
 * Union of per-role agent start params.
 *
 * @remarks Temporarily hosted here. Permanent home: `engine/runtime-adapter/types.ts`.
 */
export type AgentStartParams = PlannerStartParams | ImplementorStartParams | ReviewerStartParams;
