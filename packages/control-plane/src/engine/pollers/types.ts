import type { SpecPollerBatchResult } from '../../types.ts';
import type { GitHubClient } from '../github-client/types.ts';
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
// IssuePoller
// ---------------------------------------------------------------------------

export interface IssueSnapshot {
  issueNumber: number;
  title: string;
  statusLabel: string;
  priorityLabel: string;
  complexityLabel: string;
  createdAt: string;
}

export interface IssuePoller {
  poll: () => Promise<void>;
  getSnapshot: () => ReadonlyMap<number, IssueSnapshot>;
  getSnapshotMap: () => Map<number, IssueSnapshot>;
  updateEntry: (issueNumber: number, update: Partial<IssueSnapshot>) => void;
}

// ---------------------------------------------------------------------------
// SpecPoller
// ---------------------------------------------------------------------------

export type LogError = (message: string, error: unknown) => void;

export interface SpecPollerFileEntry {
  blobSHA: string;
  frontmatterStatus: string;
}

export interface SpecPollerSnapshot {
  specsDirTreeSHA: string | null;
  files: Record<string, SpecPollerFileEntry>;
}

export interface SpecPoller {
  poll: () => Promise<SpecPollerBatchResult>;
  getSnapshot: () => SpecPollerSnapshot;
}

// ---------------------------------------------------------------------------
// SpecPollerV2
// ---------------------------------------------------------------------------

export interface SpecPollerV2Config {
  reader: SpecProviderReader;
  getState: () => EngineState;
  enqueue: (event: SpecChanged) => void;
  interval: number;
}

export interface SpecPollerV2 {
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
// PRPoller
// ---------------------------------------------------------------------------

export type PRCIStatus = 'pending' | 'success' | 'failure';

export interface PRSnapshotEntry {
  number: number;
  title: string;
  url: string;
  headSHA: string;
  author: string;
  body: string;
  ciStatus: PRCIStatus | null;
}

export type PRPollerSnapshot = Map<number, PRSnapshotEntry>;

export interface PRPoller {
  poll: () => Promise<void>;
  getSnapshot: () => PRPollerSnapshot;
  stop: () => void;
}

export interface PRPollerConfig {
  gitHubClient: GitHubClient;
  owner: string;
  repo: string;
  pollInterval: number;
  onCIStatusChanged: (
    prNumber: number,
    oldCIStatus: PRCIStatus | null,
    newCIStatus: PRCIStatus,
  ) => void;
  onPRDetected?: (prNumber: number) => void;
  onPRRemoved: (prNumber: number) => void;
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
