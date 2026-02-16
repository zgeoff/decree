import type { PipelineResult, Revision } from '../../state-store/domain-type-stubs.ts';
import {
  type CheckRunsInput,
  type CombinedStatusInput,
  derivePipelineStatus,
} from '../mapping/derive-pipeline-status.ts';
import type { GitHubPRInput } from '../mapping/map-pr-to-revision.ts';
import { mapPRToRevision } from '../mapping/map-pr-to-revision.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { RevisionFile, RevisionFileStatus, RevisionProviderReader } from '../types.ts';

// --- Narrow Octokit interfaces ---

interface PRListResponse {
  data: GitHubPRInput[];
}

interface PRGetResponse {
  data: GitHubPRInput;
}

interface ReviewItem {
  id: number;
  user: ReviewUser | null;
  submitted_at?: string;
}

interface ReviewUser {
  login: string;
}

interface ReviewListResponse {
  data: ReviewItem[];
}

interface CombinedStatusResponse {
  data: CombinedStatusInput;
}

interface CheckRunsResponse {
  data: CheckRunsInput;
}

interface PRFileItem {
  filename: string;
  status: string;
  patch?: string;
}

interface PRFilesResponse {
  data: PRFileItem[];
}

interface PullsAPI {
  list: (params: PRListParams) => Promise<PRListResponse>;
  get: (params: PRGetParams) => Promise<PRGetResponse>;
  listReviews: (params: PRReviewsParams) => Promise<ReviewListResponse>;
  listFiles: (params: PRFilesParams) => Promise<PRFilesResponse>;
}

interface ReposAPI {
  getCombinedStatusForRef: (params: CombinedStatusParams) => Promise<CombinedStatusResponse>;
}

interface ChecksAPI {
  listForRef: (params: ChecksListParams) => Promise<CheckRunsResponse>;
}

interface PRListParams {
  owner: string;
  repo: string;
  state: 'open';
  per_page: number;
}

interface PRGetParams {
  owner: string;
  repo: string;
  pull_number: number;
}

interface PRReviewsParams {
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

interface CombinedStatusParams {
  owner: string;
  repo: string;
  ref: string;
}

interface ChecksListParams {
  owner: string;
  repo: string;
  ref: string;
  per_page: number;
}

interface PRFilesParams {
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

export interface RevisionReaderOctokit {
  pulls: PullsAPI;
  repos: ReposAPI;
  checks: ChecksAPI;
}

export interface RevisionReaderConfig {
  owner: string;
  repo: string;
  botUsername: string;
}

interface PipelineCacheEntry {
  headSHA: string;
  pipeline: PipelineResult;
}

const STATUS_NOT_FOUND = 404;

const VALID_FILE_STATUSES: Record<string, RevisionFileStatus> = {
  added: 'added',
  modified: 'modified',
  removed: 'removed',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'changed',
  unchanged: 'unchanged',
};

export function createRevisionReader(
  octokit: RevisionReaderOctokit,
  config: RevisionReaderConfig,
): RevisionProviderReader {
  const pipelineCache = new Map<string, PipelineCacheEntry>();

  return {
    listRevisions: async (): Promise<Revision[]> => {
      const response = await retryWithBackoff(() =>
        octokit.pulls.list({
          owner: config.owner,
          repo: config.repo,
          state: 'open',
          per_page: 100,
        }),
      );

      const prs = response.data;
      const revisions: Revision[] = [];

      for (const pr of prs) {
        // biome-ignore lint/performance/noAwaitInLoops: each PR needs its own review+pipeline fetch
        const [reviewID, pipeline] = await Promise.all([
          resolveReviewID(octokit, config, pr.number),
          resolvePipeline(octokit, config, pr, pipelineCache),
        ]);

        revisions.push(mapPRToRevision(pr, { pipeline, reviewID }));
      }

      return revisions;
    },

    getRevision: async (id: string): Promise<Revision | null> => {
      try {
        const response = await retryWithBackoff(() =>
          octokit.pulls.get({
            owner: config.owner,
            repo: config.repo,
            pull_number: Number(id),
          }),
        );

        return mapPRToRevision(response.data, { pipeline: null, reviewID: null });
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    getRevisionFiles: async (id: string): Promise<RevisionFile[]> => {
      const response = await retryWithBackoff(() =>
        octokit.pulls.listFiles({
          owner: config.owner,
          repo: config.repo,
          pull_number: Number(id),
          per_page: 100,
        }),
      );

      return response.data.map((file) => mapFileToRevisionFile(file));
    },
  };
}

async function resolveReviewID(
  octokit: RevisionReaderOctokit,
  config: RevisionReaderConfig,
  pullNumber: number,
): Promise<string | null> {
  const response = await retryWithBackoff(() =>
    octokit.pulls.listReviews({
      owner: config.owner,
      repo: config.repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
  );

  const botReviews = response.data.filter(
    (review) => review.user !== null && review.user.login === config.botUsername,
  );

  if (botReviews.length === 0) {
    return null;
  }

  const sorted = [...botReviews].sort((a, b) => {
    const dateA = a.submitted_at ?? '';
    const dateB = b.submitted_at ?? '';
    return dateB.localeCompare(dateA);
  });

  return String(sorted[0]?.id ?? botReviews.at(-1)?.id);
}

async function resolvePipeline(
  octokit: RevisionReaderOctokit,
  config: RevisionReaderConfig,
  pr: GitHubPRInput,
  cache: Map<string, PipelineCacheEntry>,
): Promise<PipelineResult | null> {
  const prID = String(pr.number);
  const cached = cache.get(prID);

  if (
    cached !== undefined &&
    cached.headSHA === pr.head.sha &&
    cached.pipeline.status === 'success'
  ) {
    return cached.pipeline;
  }

  try {
    const [combinedResponse, checksResponse] = await Promise.all([
      retryWithBackoff(() =>
        octokit.repos.getCombinedStatusForRef({
          owner: config.owner,
          repo: config.repo,
          ref: pr.head.sha,
        }),
      ),
      retryWithBackoff(() =>
        octokit.checks.listForRef({
          owner: config.owner,
          repo: config.repo,
          ref: pr.head.sha,
          per_page: 100,
        }),
      ),
    ]);

    const pipeline = derivePipelineStatus({
      combinedStatus: combinedResponse.data,
      checkRuns: checksResponse.data,
    });

    cache.set(prID, { headSHA: pr.head.sha, pipeline });

    return pipeline;
  } catch {
    return null;
  }
}

function mapFileToRevisionFile(file: PRFileItem): RevisionFile {
  return {
    path: file.filename,
    status: VALID_FILE_STATUSES[file.status] ?? 'changed',
    patch: file.patch ?? null,
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === STATUS_NOT_FOUND
  );
}
