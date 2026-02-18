import type { StoreApi } from 'zustand';
import type { Policy } from '../command-executor/types.ts';
import type {
  RevisionProviderReader,
  RevisionProviderWriter,
  SpecProviderReader,
  WorkProviderReader,
  WorkProviderWriter,
} from '../github-provider/types.ts';
import type { RuntimeAdapter, RuntimeAdapterDeps } from '../runtime-adapter/types.ts';
import type { AgentRole, EngineEvent } from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';

// --- Unsubscribe ---

export type Unsubscribe = () => void;

// --- Engine ---

export interface Engine {
  store: StoreApi<EngineState>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  enqueue: (event: EngineEvent) => void;
  getState: () => EngineState;
  subscribe: (listener: (state: EngineState) => void) => Unsubscribe;
  getWorkItemBody: (id: string) => Promise<string>;
  getRevisionFiles: (id: string) => Promise<import('../github-provider/types.ts').RevisionFile[]>;
  getAgentStream: (sessionID: string) => AsyncIterable<string> | null;
  refresh: () => void;
}

// --- EngineConfig ---

export interface EngineConfig {
  provider: {
    workItemReader: WorkProviderReader;
    workItemWriter: WorkProviderWriter;
    revisionReader: RevisionProviderReader;
    revisionWriter: RevisionProviderWriter;
    specReader: SpecProviderReader;
  };
  createRuntimeAdapters: (deps: RuntimeAdapterDeps) => Record<AgentRole, RuntimeAdapter>;
  policy?: Policy;
  logLevel?: 'debug' | 'info' | 'error';
  shutdownTimeout?: number;
  workItemPoller?: {
    pollInterval?: number;
  };
  revisionPoller?: {
    pollInterval?: number;
  };
  specPoller?: {
    pollInterval?: number;
  };
}
