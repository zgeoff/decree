import type { AgentReview, Revision } from '../../state-store/domain-type-stubs.ts';
import type { GitHubPRInput } from '../mapping/map-pr-to-revision.ts';
import { mapPRToRevision } from '../mapping/map-pr-to-revision.ts';
import { matchClosingKeywords } from '../mapping/match-closing-keywords.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { RevisionProviderWriter } from '../types.ts';

// --- Narrow Octokit interface types ---

interface GitRef {
  data: {
    object: {
      sha: string;
    };
  };
}

interface GitCommit {
  data: {
    sha: string;
    tree: {
      sha: string;
    };
  };
}

interface GitBlob {
  data: {
    sha: string;
  };
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}

interface GitTree {
  data: {
    sha: string;
  };
}

interface GitCreateCommit {
  data: {
    sha: string;
  };
}

interface PRResponse {
  data: {
    number: number;
    title: string;
    html_url: string;
    head: {
      sha: string;
      ref: string;
    };
    user: {
      login: string;
    } | null;
    body: string | null;
    draft?: boolean;
  };
}

interface PRListItem {
  number: number;
  title: string;
  html_url: string;
  head: {
    sha: string;
    ref: string;
  };
  user: {
    login: string;
  } | null;
  body: string | null;
  draft?: boolean;
}

interface PRListResponse {
  data: PRListItem[];
}

interface IssueResponse {
  data: {
    title: string;
  };
}

interface ReviewResponse {
  data: {
    id: number;
  };
}

interface ReviewComment {
  path: string;
  body: string;
  line?: number;
}

interface OctokitGit {
  getRef: (params: { owner: string; repo: string; ref: string }) => Promise<GitRef>;
  getCommit: (params: { owner: string; repo: string; commit_sha: string }) => Promise<GitCommit>;
  createBlob: (params: {
    owner: string;
    repo: string;
    content: string;
    encoding: string;
  }) => Promise<GitBlob>;
  createTree: (params: {
    owner: string;
    repo: string;
    base_tree: string;
    tree: TreeEntry[];
  }) => Promise<GitTree>;
  createCommit: (params: {
    owner: string;
    repo: string;
    message: string;
    tree: string;
    parents: string[];
  }) => Promise<GitCreateCommit>;
  createRef: (params: {
    owner: string;
    repo: string;
    ref: string;
    sha: string;
  }) => Promise<unknown>;
  updateRef: (params: {
    owner: string;
    repo: string;
    ref: string;
    sha: string;
    force: boolean;
  }) => Promise<unknown>;
}

interface OctokitPulls {
  create: (params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }) => Promise<PRResponse>;
  list: (params: {
    owner: string;
    repo: string;
    state: string;
    per_page: number;
  }) => Promise<PRListResponse>;
  get: (params: { owner: string; repo: string; pull_number: number }) => Promise<PRResponse>;
  update: (params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  }) => Promise<PRResponse>;
  createReview: (params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
    event: string;
    comments?: ReviewComment[];
  }) => Promise<ReviewResponse>;
  dismissReview: (params: {
    owner: string;
    repo: string;
    pull_number: number;
    review_id: number;
    message: string;
  }) => Promise<unknown>;
}

interface OctokitIssues {
  get: (params: { owner: string; repo: string; issue_number: number }) => Promise<IssueResponse>;
  createComment: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }) => Promise<unknown>;
}

export interface RevisionWriterOctokit {
  git: OctokitGit;
  pulls: OctokitPulls;
  issues: OctokitIssues;
}

export interface RevisionWriterConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface RevisionWriterDeps {
  octokit: RevisionWriterOctokit;
  config: RevisionWriterConfig;
}

export function createRevisionWriter(deps: RevisionWriterDeps): RevisionProviderWriter {
  return {
    createFromPatch: async (
      workItemID: string,
      patch: string,
      branchName: string,
    ): Promise<Revision> => createFromPatch(deps, workItemID, patch, branchName),
    updateBody: async (revisionID: string, body: string): Promise<void> => {
      await updateBody(deps, revisionID, body);
    },
    postReview: async (revisionID: string, review: AgentReview): Promise<string> =>
      postReview(deps, revisionID, review),
    updateReview: async (
      revisionID: string,
      reviewID: string,
      review: AgentReview,
    ): Promise<void> => {
      await updateReviewFn(deps, revisionID, reviewID, review);
    },
    postComment: async (revisionID: string, body: string): Promise<void> => {
      await postComment(deps, revisionID, body);
    },
  };
}

// --- Helpers ---

interface ParsedDiffFile {
  path: string;
  action: 'add' | 'modify' | 'delete';
  content: string | null;
}

async function createFromPatch(
  deps: RevisionWriterDeps,
  workItemID: string,
  patch: string,
  branchName: string,
): Promise<Revision> {
  // Step 1: Fetch default branch HEAD commit and its tree
  const headRef = await retryWithBackoff(() =>
    deps.octokit.git.getRef({
      owner: deps.config.owner,
      repo: deps.config.repo,
      ref: `heads/${deps.config.defaultBranch}`,
    }),
  );

  const defaultBranchSHA = headRef.data.object.sha;

  const headCommit = await retryWithBackoff(() =>
    deps.octokit.git.getCommit({
      owner: deps.config.owner,
      repo: deps.config.repo,
      commit_sha: defaultBranchSHA,
    }),
  );

  const baseTreeSHA = headCommit.data.tree.sha;

  // Step 2: Parse the unified diff
  const diffFiles = parseUnifiedDiff(patch);

  // Step 3: Create blobs and build the tree
  const treeEntries: TreeEntry[] = [];

  for (const file of diffFiles) {
    if (file.action === 'delete') {
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
    } else if (file.content !== null) {
      const fileContent = file.content;
      // biome-ignore lint/performance/noAwaitInLoops: sequential blob creation required for tree construction
      const blob = await retryWithBackoff(() =>
        deps.octokit.git.createBlob({
          owner: deps.config.owner,
          repo: deps.config.repo,
          content: fileContent,
          encoding: 'utf-8',
        }),
      );

      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      });
    }
  }

  const newTree = await retryWithBackoff(() =>
    deps.octokit.git.createTree({
      owner: deps.config.owner,
      repo: deps.config.repo,
      base_tree: baseTreeSHA,
      tree: treeEntries,
    }),
  );

  // Step 4: Determine the commit parent
  let parentSHA = defaultBranchSHA;
  let branchExists = false;

  try {
    const branchRef = await retryWithBackoff(() =>
      deps.octokit.git.getRef({
        owner: deps.config.owner,
        repo: deps.config.repo,
        ref: `heads/${branchName}`,
      }),
    );

    parentSHA = branchRef.data.object.sha;
    branchExists = true;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      branchExists = false;
    } else {
      throw error;
    }
  }

  // Step 5: Create the commit
  const commitMessage = `decree: apply patch for #${workItemID}`;

  const newCommit = await retryWithBackoff(() =>
    deps.octokit.git.createCommit({
      owner: deps.config.owner,
      repo: deps.config.repo,
      message: commitMessage,
      tree: newTree.data.sha,
      parents: [parentSHA],
    }),
  );

  // Step 6: Create or update the branch ref
  if (branchExists) {
    await retryWithBackoff(() =>
      deps.octokit.git.updateRef({
        owner: deps.config.owner,
        repo: deps.config.repo,
        ref: `heads/${branchName}`,
        sha: newCommit.data.sha,
        force: true,
      }),
    );
  } else {
    await retryWithBackoff(() =>
      deps.octokit.git.createRef({
        owner: deps.config.owner,
        repo: deps.config.repo,
        ref: `refs/heads/${branchName}`,
        sha: newCommit.data.sha,
      }),
    );
  }

  // Step 7: Check for existing PR
  const prs = await retryWithBackoff(() =>
    deps.octokit.pulls.list({
      owner: deps.config.owner,
      repo: deps.config.repo,
      state: 'open',
      per_page: 100,
    }),
  );

  let existingPR: PRListItem | null = null;

  // First: look for branch-name match
  for (const pr of prs.data) {
    if (pr.head.ref === branchName) {
      existingPR = pr;
      break;
    }
  }

  // If no branch-name match, check for closing-keyword match
  if (existingPR === null) {
    for (const pr of prs.data) {
      const linkedWorkItemID = matchClosingKeywords(pr.body ?? '');
      if (linkedWorkItemID === workItemID) {
        // Step 10: Different branch — abnormal state, ignore and create new PR
        if (pr.head.ref !== branchName) {
          break;
        }
        existingPR = pr;
        break;
      }
    }
  }

  if (existingPR !== null) {
    // Step 9: Branch-name match — PR updates automatically via branch push
    const prInput: GitHubPRInput = {
      number: existingPR.number,
      title: existingPR.title,
      html_url: existingPR.html_url,
      head: {
        sha: newCommit.data.sha,
        ref: branchName,
      },
      user: existingPR.user,
      body: existingPR.body,
      draft: existingPR.draft ?? false,
    };

    return mapPRToRevision(prInput, { pipeline: null, reviewID: null });
  }

  // Step 8: No existing PR — create one
  const issueResponse = await retryWithBackoff(() =>
    deps.octokit.issues.get({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: Number(workItemID),
    }),
  );

  const prBody = `Closes #${workItemID}`;

  const newPR = await retryWithBackoff(() =>
    deps.octokit.pulls.create({
      owner: deps.config.owner,
      repo: deps.config.repo,
      title: issueResponse.data.title,
      body: prBody,
      head: branchName,
      base: deps.config.defaultBranch,
    }),
  );

  const prInput: GitHubPRInput = {
    number: newPR.data.number,
    title: newPR.data.title,
    html_url: newPR.data.html_url,
    head: {
      sha: newPR.data.head.sha,
      ref: newPR.data.head.ref,
    },
    user: newPR.data.user,
    body: newPR.data.body,
    draft: newPR.data.draft ?? false,
  };

  return mapPRToRevision(prInput, { pipeline: null, reviewID: null });
}

async function updateBody(
  deps: RevisionWriterDeps,
  revisionID: string,
  body: string,
): Promise<void> {
  const pullNumber = Number(revisionID);

  await retryWithBackoff(() =>
    deps.octokit.pulls.update({
      owner: deps.config.owner,
      repo: deps.config.repo,
      pull_number: pullNumber,
      body,
    }),
  );
}

const VERDICT_MAP: Record<string, string> = {
  approve: 'APPROVE',
  'needs-changes': 'REQUEST_CHANGES',
};

async function postReview(
  deps: RevisionWriterDeps,
  revisionID: string,
  review: AgentReview,
): Promise<string> {
  const pullNumber = Number(revisionID);
  const event = VERDICT_MAP[review.verdict] ?? 'COMMENT';

  const comments: ReviewComment[] = review.comments.map(buildReviewComment);

  const baseParams = {
    owner: deps.config.owner,
    repo: deps.config.repo,
    pull_number: pullNumber,
    body: review.summary,
    event,
  };

  const reviewParams = comments.length > 0 ? { ...baseParams, comments } : baseParams;

  const response = await retryWithBackoff(() => deps.octokit.pulls.createReview(reviewParams));

  return String(response.data.id);
}

async function updateReviewFn(
  deps: RevisionWriterDeps,
  revisionID: string,
  reviewID: string,
  review: AgentReview,
): Promise<void> {
  const pullNumber = Number(revisionID);
  const reviewIDNum = Number(reviewID);

  await retryWithBackoff(() =>
    deps.octokit.pulls.dismissReview({
      owner: deps.config.owner,
      repo: deps.config.repo,
      pull_number: pullNumber,
      review_id: reviewIDNum,
      message: 'Replacing with updated review',
    }),
  );

  await postReview(deps, revisionID, review);
}

async function postComment(
  deps: RevisionWriterDeps,
  revisionID: string,
  body: string,
): Promise<void> {
  const pullNumber = Number(revisionID);

  await retryWithBackoff(() =>
    deps.octokit.issues.createComment({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: pullNumber,
      body,
    }),
  );
}

function buildReviewComment(comment: {
  path: string;
  line: number | null;
  body: string;
}): ReviewComment {
  const result: ReviewComment = {
    path: comment.path,
    body: comment.body,
  };

  if (comment.line !== null) {
    result.line = comment.line;
  }

  return result;
}

const DIFF_HEADER_PREFIX = 'diff --git';
const PLUS_FILE_PREFIX = '+++ ';
const MINUS_FILE_PREFIX = '--- ';
const B_PATH_PREFIX = 'b/';
const A_PATH_PREFIX = 'a/';
const DEV_NULL = '/dev/null';
const HUNK_HEADER_PREFIX = '@@';
const NO_NEWLINE_MARKER = '\\ No newline at end of file';
const PATH_PREFIX_LENGTH = 4;
const AB_PREFIX_LENGTH = 2;
const LOOKBACK_OFFSET = 2;

function parseUnifiedDiff(patch: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  const lines = patch.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line === undefined || !line.startsWith(DIFF_HEADER_PREFIX)) {
      i += 1;
    } else {
      const result = parseSingleDiff(lines, i);
      i = result.nextIndex;
      if (result.file !== null) {
        files.push(result.file);
      }
    }
  }

  return files;
}

interface ParseDiffResult {
  file: ParsedDiffFile | null;
  nextIndex: number;
}

function parseSingleDiff(lines: string[], startIndex: number): ParseDiffResult {
  let filePath = '';
  let action: 'add' | 'modify' | 'delete' = 'modify';
  let i = startIndex + 1;

  // Parse header lines
  const headerResult = parseDiffHeader(lines, i);
  i = headerResult.nextIndex;
  filePath = headerResult.filePath;
  action = headerResult.action;

  // For deletes, extract from the --- a/path
  if (action === 'delete' && filePath === '') {
    filePath = extractDeletePath(lines, i);
  }

  if (filePath === '' && action !== 'delete') {
    return { file: null, nextIndex: i };
  }

  if (action === 'delete') {
    return { file: { path: filePath, action: 'delete', content: null }, nextIndex: i };
  }

  // Collect content from hunk lines
  const hunkResult = collectHunkContent(lines, i);
  const content = hunkResult.contentLines.join('\n');

  return {
    file: { path: filePath, action, content },
    nextIndex: hunkResult.nextIndex,
  };
}

interface HeaderResult {
  filePath: string;
  action: 'add' | 'modify' | 'delete';
  nextIndex: number;
}

function parseDiffHeader(lines: string[], startIndex: number): HeaderResult {
  let filePath = '';
  let action: 'add' | 'modify' | 'delete' = 'modify';
  let i = startIndex;

  while (i < lines.length) {
    const headerLine = lines[i];

    if (headerLine === undefined) {
      i += 1;
    } else if (headerLine.startsWith('new file mode')) {
      action = 'add';
      i += 1;
    } else if (headerLine.startsWith('deleted file mode')) {
      action = 'delete';
      i += 1;
    } else if (headerLine.startsWith('index ') || headerLine.startsWith(MINUS_FILE_PREFIX)) {
      i += 1;
    } else if (headerLine.startsWith(PLUS_FILE_PREFIX)) {
      const plusPath = headerLine.slice(PATH_PREFIX_LENGTH);
      if (plusPath !== DEV_NULL) {
        filePath = plusPath.startsWith(B_PATH_PREFIX) ? plusPath.slice(AB_PREFIX_LENGTH) : plusPath;
      }
      i += 1;
      break;
    } else {
      break;
    }
  }

  return { filePath, action, nextIndex: i };
}

function extractDeletePath(lines: string[], currentIndex: number): string {
  for (let j = currentIndex - LOOKBACK_OFFSET; j >= 0; j -= 1) {
    const prevLine = lines[j];
    if (prevLine?.startsWith(MINUS_FILE_PREFIX)) {
      const minusPath = prevLine.slice(PATH_PREFIX_LENGTH);
      if (minusPath !== DEV_NULL) {
        return minusPath.startsWith(A_PATH_PREFIX) ? minusPath.slice(AB_PREFIX_LENGTH) : minusPath;
      }
      break;
    }
  }
  return '';
}

interface HunkResult {
  contentLines: string[];
  nextIndex: number;
}

function collectHunkContent(lines: string[], startIndex: number): HunkResult {
  const contentLines: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const hunkLine = lines[i];

    if (hunkLine === undefined) {
      i += 1;
    } else if (hunkLine.startsWith(DIFF_HEADER_PREFIX)) {
      break;
    } else if (hunkLine.startsWith(HUNK_HEADER_PREFIX)) {
      i += 1;
    } else if (hunkLine.startsWith('+')) {
      contentLines.push(hunkLine.slice(1));
      i += 1;
    } else if (hunkLine.startsWith('-')) {
      i += 1;
    } else if (hunkLine.startsWith(' ')) {
      contentLines.push(hunkLine.slice(1));
      i += 1;
    } else if (hunkLine === NO_NEWLINE_MARKER) {
      i += 1;
    } else {
      i += 1;
    }
  }

  return { contentLines, nextIndex: i };
}

const STATUS_NOT_FOUND = 404;

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === STATUS_NOT_FOUND
  );
}
