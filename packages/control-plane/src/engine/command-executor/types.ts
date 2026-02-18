import type { RevisionProviderWriter, WorkProviderWriter } from '../github-provider/types.ts';
import type { AgentRunHandle, RuntimeAdapter } from '../runtime-adapter/types.ts';
import type { AgentRole, EngineCommand, EngineEvent } from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';

// Re-export runtime adapter types for backward compatibility
export type {
  AgentRunHandle,
  AgentStartParams,
  ImplementorStartParams,
  PlannerStartParams,
  ReviewerStartParams,
  RuntimeAdapter,
} from '../runtime-adapter/types.ts';

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
  onHandleRegistered?: (sessionID: string, handle: AgentRunHandle) => void;
  onHandleRemoved?: (sessionID: string) => void;
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
