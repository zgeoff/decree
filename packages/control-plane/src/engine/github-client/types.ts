// Narrow interface over @octokit/rest's Octokit client. Only the methods and
// response shapes actually used by production code are declared here, which
// keeps tests type-safe without casts — mocks satisfy this interface naturally
// while Octokit's deeply generic types would require `as never` everywhere.
//
// Param interfaces include `[key: string]: unknown` so they satisfy Octokit's
// `RequestParameters` index signature without casts at the call site.

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

export interface AppsGetAuthenticatedResult {
  data: {
    slug: string;
  };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface IssueLabel {
  name?: string;
}

export interface IssuesGetParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
}

export interface IssueData {
  number: number;
  title: string;
  body: string | null;
  labels: (string | IssueLabel)[];
  created_at: string;
}

export interface IssuesGetResult {
  data: IssueData;
}

export interface IssuesListForRepoParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  labels: string;
  state: 'open' | 'closed' | 'all';
  per_page: number;
}

export interface IssuesListForRepoResult {
  data: IssueData[];
}

export interface IssuesCreateParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
}

export interface IssuesCreateResult {
  data: IssueData;
}

export interface IssuesUpdateParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
}

export interface IssuesUpdateResult {
  data: IssueData;
}

export interface IssuesListLabelsOnIssueParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
  per_page: number;
}

export interface IssuesListLabelsOnIssueResult {
  data: IssueLabel[];
}

export interface IssuesAddLabelsParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
  labels: string[];
}

export interface IssuesAddLabelsResult {
  data: unknown;
}

export interface IssuesRemoveLabelParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
  name: string;
}

export interface IssuesRemoveLabelResult {
  data: unknown;
}

export interface IssuesCreateCommentParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

export interface IssuesCreateCommentResult {
  data: unknown;
}

// ---------------------------------------------------------------------------
// Pulls
// ---------------------------------------------------------------------------

export interface PullsListParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  state: 'open' | 'closed' | 'all';
  per_page: number;
}

export interface PullsListItem {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  head: PullHeadRef;
  body: string | null;
  draft: boolean;
}

export interface PullsListResult {
  data: PullsListItem[];
}

export interface PullsGetParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
}

export interface PullHeadRef {
  sha: string;
  ref: string;
}

export interface PullData {
  number: number;
  title: string;
  changed_files: number;
  html_url: string;
  user: { login: string } | null;
  head: PullHeadRef;
  body: string | null;
  draft: boolean;
}

export interface PullsGetResult {
  data: PullData;
}

export interface PullsListFilesParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

export interface PullFileEntry {
  filename: string;
  status: string;
  patch?: string;
}

export interface PullsListFilesResult {
  data: PullFileEntry[];
}

export interface PullsListReviewsParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

export interface PullReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  submitted_at?: string;
}

export interface PullsListReviewsResult {
  data: PullReview[];
}

export interface PullsListReviewCommentsParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

export interface PullReviewComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  path: string;
  line: number | null;
}

export interface PullsListReviewCommentsResult {
  data: PullReviewComment[];
}

export interface PullsCreateParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullsCreateResult {
  data: PullsListItem;
}

export interface PullsUpdateParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  body?: string;
}

export interface PullsUpdateResult {
  data: unknown;
}

export interface PullsReviewComment {
  path: string;
  body: string;
  line?: number;
  side?: string;
}

export interface PullsCreateReviewParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: PullsReviewComment[];
}

export interface PullsCreateReviewResult {
  data: {
    id: number;
  };
}

export interface PullsDismissReviewParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  pull_number: number;
  review_id: number;
  message: string;
}

export interface PullsDismissReviewResult {
  data: unknown;
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export interface ReposGetCombinedStatusParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  ref: string;
}

export interface CombinedStatusData {
  state: string;
  total_count: number;
}

export interface ReposGetCombinedStatusResult {
  data: CombinedStatusData;
}

export interface ReposGetContentParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export interface ReposContentData {
  sha?: string;
  content?: string;
}

export interface ReposGetContentResult {
  data: ReposContentData;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface ChecksListForRefParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  ref: string;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

export interface ChecksListForRefData {
  total_count: number;
  check_runs: CheckRun[];
}

export interface ChecksListForRefResult {
  data: ChecksListForRefData;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface GitGetTreeParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  tree_sha: string;
  recursive?: string;
}

export interface TreeEntry {
  path?: string;
  sha?: string;
  type?: string;
}

export interface GitTreeData {
  sha: string;
  tree: TreeEntry[];
}

export interface GitGetTreeResult {
  data: GitTreeData;
}

export interface GitGetRefParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  ref: string;
}

export interface GitRefObject {
  sha: string;
}

export interface GitRefData {
  object: GitRefObject;
}

export interface GitGetRefResult {
  data: GitRefData;
}

export interface GitGetBlobParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  file_sha: string;
}

export interface GitGetBlobResult {
  data: {
    content: string;
    encoding: string;
  };
}

export interface GitGetCommitParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  commit_sha: string;
}

export interface GitGetCommitResult {
  data: {
    sha: string;
    tree: {
      sha: string;
    };
  };
}

export interface GitCreateBlobParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  content: string;
  encoding: string;
}

export interface GitCreateBlobResult {
  data: {
    sha: string;
  };
}

export type GitTreeMode = '100644' | '100755' | '040000' | '160000' | '120000';

export type GitTreeType = 'tree' | 'blob' | 'commit';

export interface GitCreateTreeEntry {
  path: string;
  mode: GitTreeMode;
  type: GitTreeType;
  sha: string | null;
}

export interface GitCreateTreeParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  base_tree: string;
  tree: GitCreateTreeEntry[];
}

export interface GitCreateTreeResult {
  data: {
    sha: string;
  };
}

export interface GitCreateCommitParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  message: string;
  tree: string;
  parents: string[];
}

export interface GitCreateCommitResult {
  data: {
    sha: string;
  };
}

export interface GitCreateRefParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  ref: string;
  sha: string;
}

export interface GitCreateRefResult {
  data: unknown;
}

export interface GitUpdateRefParams {
  [key: string]: unknown;
  owner: string;
  repo: string;
  ref: string;
  sha: string;
  force?: boolean;
}

export interface GitUpdateRefResult {
  data: unknown;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GitHubClientConfig {
  appID: number;
  privateKey: string;
  installationID: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface GitHubClient {
  apps: {
    getAuthenticated: () => Promise<AppsGetAuthenticatedResult>;
  };
  issues: {
    get: (params: IssuesGetParams) => Promise<IssuesGetResult>;
    listForRepo: (params: IssuesListForRepoParams) => Promise<IssuesListForRepoResult>;
    create: (params: IssuesCreateParams) => Promise<IssuesCreateResult>;
    update: (params: IssuesUpdateParams) => Promise<IssuesUpdateResult>;
    listLabelsOnIssue: (
      params: IssuesListLabelsOnIssueParams,
    ) => Promise<IssuesListLabelsOnIssueResult>;
    addLabels: (params: IssuesAddLabelsParams) => Promise<IssuesAddLabelsResult>;
    removeLabel: (params: IssuesRemoveLabelParams) => Promise<IssuesRemoveLabelResult>;
    createComment: (params: IssuesCreateCommentParams) => Promise<IssuesCreateCommentResult>;
  };
  pulls: {
    list: (params: PullsListParams) => Promise<PullsListResult>;
    get: (params: PullsGetParams) => Promise<PullsGetResult>;
    listFiles: (params: PullsListFilesParams) => Promise<PullsListFilesResult>;
    listReviews: (params: PullsListReviewsParams) => Promise<PullsListReviewsResult>;
    listReviewComments: (
      params: PullsListReviewCommentsParams,
    ) => Promise<PullsListReviewCommentsResult>;
    create: (params: PullsCreateParams) => Promise<PullsCreateResult>;
    update: (params: PullsUpdateParams) => Promise<PullsUpdateResult>;
    createReview: (params: PullsCreateReviewParams) => Promise<PullsCreateReviewResult>;
    dismissReview: (params: PullsDismissReviewParams) => Promise<PullsDismissReviewResult>;
  };
  repos: {
    getCombinedStatusForRef: (
      params: ReposGetCombinedStatusParams,
    ) => Promise<ReposGetCombinedStatusResult>;
    getContent: (params: ReposGetContentParams) => Promise<ReposGetContentResult>;
  };
  checks: {
    listForRef: (params: ChecksListForRefParams) => Promise<ChecksListForRefResult>;
  };
  git: {
    getTree: (params: GitGetTreeParams) => Promise<GitGetTreeResult>;
    getRef: (params: GitGetRefParams) => Promise<GitGetRefResult>;
    getBlob: (params: GitGetBlobParams) => Promise<GitGetBlobResult>;
    getCommit: (params: GitGetCommitParams) => Promise<GitGetCommitResult>;
    createBlob: (params: GitCreateBlobParams) => Promise<GitCreateBlobResult>;
    createTree: (params: GitCreateTreeParams) => Promise<GitCreateTreeResult>;
    createCommit: (params: GitCreateCommitParams) => Promise<GitCreateCommitResult>;
    createRef: (params: GitCreateRefParams) => Promise<GitCreateRefResult>;
    updateRef: (params: GitUpdateRefParams) => Promise<GitUpdateRefResult>;
  };
}
