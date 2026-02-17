import type {
  RevisionProviderReader,
  SpecProviderReader,
  WorkProviderReader,
} from '../github-provider/types.ts';
import type {
  RevisionChanged,
  SpecChanged,
  WorkItemChanged,
} from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';

// ---------------------------------------------------------------------------
// SpecPoller
// ---------------------------------------------------------------------------

export interface SpecPollerFileEntry {
  blobSHA: string;
  frontmatterStatus: string;
}

export interface SpecPollerSnapshot {
  specsDirTreeSHA: string | null;
  files: Record<string, SpecPollerFileEntry>;
}

export interface SpecPollerConfig {
  reader: SpecProviderReader;
  getState: () => EngineState;
  enqueue: (event: SpecChanged) => void;
  interval: number;
  getDefaultBranchSHA: () => Promise<string>;
}

export interface SpecPoller {
  poll: () => Promise<void>;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// WorkItemPoller
// ---------------------------------------------------------------------------

export interface WorkItemPoller {
  poll: () => Promise<void>;
  stop: () => void;
}

export interface WorkItemPollerConfig {
  reader: WorkProviderReader;
  getState: () => EngineState;
  enqueue: (event: WorkItemChanged) => void;
  interval: number;
}

// ---------------------------------------------------------------------------
// RevisionPoller
// ---------------------------------------------------------------------------

export interface RevisionPoller {
  poll: () => Promise<void>;
  stop: () => void;
}

export interface RevisionPollerConfig {
  reader: RevisionProviderReader;
  getState: () => EngineState;
  enqueue: (event: RevisionChanged) => void;
  interval: number;
}
