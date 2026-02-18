import type { RevisionFile } from '../engine/github-provider/types.ts';
import type {
  AgentRun,
  ImplementorRun,
  ReviewerRun,
  Revision,
  WorkItem,
  WorkItemStatus,
} from '../engine/state-store/types.ts';

// ---------------------------------------------------------------------------
// Display Status
// ---------------------------------------------------------------------------

export type DisplayStatus =
  | 'approved'
  | 'failed'
  | 'blocked'
  | 'needs-refinement'
  | 'dispatch'
  | 'pending'
  | 'implementing'
  | 'reviewing';

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export type Section = 'action' | 'agents';

// ---------------------------------------------------------------------------
// Display Work Item
// ---------------------------------------------------------------------------

export interface DisplayWorkItem {
  workItem: WorkItem;
  displayStatus: DisplayStatus;
  section: Section;
  linkedRevision: Revision | null;
  latestRun: AgentRun | null;
  dispatchCount: number;
}

// ---------------------------------------------------------------------------
// TUI Local State
// ---------------------------------------------------------------------------

export interface CachedDetail {
  body: string | null;
  revisionFiles: RevisionFile[] | null;
  loading: boolean;
}

export interface TUILocalState {
  selectedWorkItem: string | null;
  pinnedWorkItem: string | null;
  focusedPane: 'workItemList' | 'detailPane';
  shuttingDown: boolean;
  streamBuffers: Map<string, string[]>;
  detailCache: Map<string, CachedDetail>;
}

// ---------------------------------------------------------------------------
// TUI Config
// ---------------------------------------------------------------------------

export interface TUIConfig {
  repoOwner: string;
  repoName: string;
}

// ---------------------------------------------------------------------------
// TUI Actions
// ---------------------------------------------------------------------------

export interface TUIActions {
  dispatchImplementor: (workItemID: string) => void;
  shutdown: () => void;
  selectWorkItem: (workItemID: string) => void;
  pinWorkItem: (workItemID: string) => void;
  cycleFocus: () => void;
}

// ---------------------------------------------------------------------------
// Display Status Derivation
// ---------------------------------------------------------------------------

export function deriveDisplayStatus(
  workItem: WorkItem,
  agentRuns: AgentRun[],
): DisplayStatus | null {
  const implementorAndReviewerRuns = agentRuns.filter(
    (run): run is ImplementorRun | ReviewerRun =>
      run.role === 'implementor' || run.role === 'reviewer',
  );

  const latestRun =
    implementorAndReviewerRuns.length > 0
      ? implementorAndReviewerRuns.reduce((latest, current) =>
          current.startedAt > latest.startedAt ? current : latest,
        )
      : null;

  if (latestRun !== null) {
    if (latestRun.status === 'requested' || latestRun.status === 'running') {
      return latestRun.role === 'implementor' ? 'implementing' : 'reviewing';
    }

    if (latestRun.status === 'failed' || latestRun.status === 'timed-out') {
      return 'failed';
    }
  }

  const statusMap: Record<WorkItemStatus, DisplayStatus | null> = {
    pending: 'pending',
    ready: 'dispatch',
    'in-progress': 'implementing',
    review: 'reviewing',
    approved: 'approved',
    'needs-refinement': 'needs-refinement',
    blocked: 'blocked',
    closed: null,
  };

  return statusMap[workItem.status];
}
