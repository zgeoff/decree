import type {
  AgentReview,
  ReviewHistory,
  Revision,
  Spec,
  WorkItem,
  WorkItemStatus,
} from '../state-store/domain-type-stubs.ts';

// --- Provider reader interfaces ---

export interface WorkProviderReader {
  listWorkItems: () => Promise<WorkItem[]>;
  getWorkItem: (id: string) => Promise<WorkItem | null>;
  getWorkItemBody: (id: string) => Promise<string>;
}

export interface RevisionProviderReader {
  listRevisions: () => Promise<Revision[]>;
  getRevision: (id: string) => Promise<Revision | null>;
  getRevisionFiles: (id: string) => Promise<RevisionFile[]>;
  getReviewHistory: (revisionID: string) => Promise<ReviewHistory>;
}

export interface SpecProviderReader {
  listSpecs: () => Promise<Spec[]>;
  getDefaultBranchSHA: () => Promise<string>;
}

// --- Provider writer interfaces ---

export interface WorkProviderWriter {
  transitionStatus: (workItemID: string, newStatus: WorkItemStatus) => Promise<void>;
  createWorkItem: (
    title: string,
    body: string,
    labels: string[],
    blockedBy: string[],
  ) => Promise<WorkItem>;
  updateWorkItem: (
    workItemID: string,
    body: string | null,
    labels: string[] | null,
  ) => Promise<void>;
}

export interface RevisionProviderWriter {
  createFromPatch: (workItemID: string, patch: string, branchName: string) => Promise<Revision>;
  updateBody: (revisionID: string, body: string) => Promise<void>;
  postReview: (revisionID: string, review: AgentReview) => Promise<string>;
  updateReview: (revisionID: string, reviewID: string, review: AgentReview) => Promise<void>;
  postComment: (revisionID: string, body: string) => Promise<void>;
}

// --- Domain types ---

export type RevisionFileStatus =
  | 'added'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

export interface RevisionFile {
  path: string;
  status: RevisionFileStatus;
  patch: string | null;
}

// --- Configuration ---

export interface GitHubProviderConfig {
  appID: number;
  privateKey: string;
  installationID: number;
  owner: string;
  repo: string;
  specsDir: string;
  defaultBranch: string;
}

// --- Composite provider ---

export interface GitHubProvider {
  workItemReader: WorkProviderReader;
  workItemWriter: WorkProviderWriter;
  revisionReader: RevisionProviderReader;
  revisionWriter: RevisionProviderWriter;
  specReader: SpecProviderReader;
}
