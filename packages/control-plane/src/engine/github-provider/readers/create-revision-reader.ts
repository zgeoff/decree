import invariant from 'tiny-invariant';
import type { GitHubClient } from '../../github-client/types.ts';
import type {
  PipelineResult,
  ReviewHistory,
  ReviewInlineComment,
  ReviewSubmission,
  Revision,
} from '../../state-store/domain-type-stubs.ts';
import { isNotFoundError } from '../is-not-found-error.ts';
import { derivePipelineStatus } from '../mapping/derive-pipeline-status.ts';
import type { GitHubPRInput } from '../mapping/map-pr-to-revision.ts';
import { mapPRToRevision } from '../mapping/map-pr-to-revision.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { RevisionFile, RevisionFileStatus, RevisionProviderReader } from '../types.ts';

export interface RevisionReaderConfig {
  owner: string;
  repo: string;
  botUsername: string;
}

export interface RevisionReaderDeps {
  client: GitHubClient;
  config: RevisionReaderConfig;
}

interface PipelineCacheEntry {
  headSHA: string;
  pipeline: PipelineResult;
}

const VALID_FILE_STATUSES: Record<string, RevisionFileStatus> = {
  added: 'added',
  modified: 'modified',
  removed: 'removed',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'changed',
  unchanged: 'unchanged',
};

export function createRevisionReader(deps: RevisionReaderDeps): RevisionProviderReader {
  const pipelineCache = new Map<string, PipelineCacheEntry>();

  return {
    listRevisions: async (): Promise<Revision[]> => {
      const response = await retryWithBackoff(() =>
        deps.client.pulls.list({
          owner: deps.config.owner,
          repo: deps.config.repo,
          state: 'open',
          per_page: 100,
        }),
      );

      const prs = response.data;
      const revisions: Revision[] = [];

      for (const pr of prs) {
        // biome-ignore lint/performance/noAwaitInLoops: each PR needs its own review+pipeline fetch
        const [reviewID, pipeline] = await Promise.all([
          resolveReviewID(deps, pr.number),
          resolvePipeline(deps, pr, pipelineCache),
        ]);

        revisions.push(mapPRToRevision(pr, { pipeline, reviewID }));
      }

      return revisions;
    },

    getRevision: async (id: string): Promise<Revision | null> => {
      try {
        const response = await retryWithBackoff(() =>
          deps.client.pulls.get({
            owner: deps.config.owner,
            repo: deps.config.repo,
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
        deps.client.pulls.listFiles({
          owner: deps.config.owner,
          repo: deps.config.repo,
          pull_number: Number(id),
          per_page: 100,
        }),
      );

      return response.data.map((file) => mapFileToRevisionFile(file));
    },

    getReviewHistory: async (revisionID: string): Promise<ReviewHistory> =>
      fetchReviewHistory(deps, Number(revisionID)),
  };
}

async function fetchReviewHistory(
  deps: RevisionReaderDeps,
  pullNumber: number,
): Promise<ReviewHistory> {
  const [reviewsResponse, commentsResponse] = await Promise.all([
    retryWithBackoff(() =>
      deps.client.pulls.listReviews({
        owner: deps.config.owner,
        repo: deps.config.repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
    ),
    retryWithBackoff(() =>
      deps.client.pulls.listReviewComments({
        owner: deps.config.owner,
        repo: deps.config.repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
    ),
  ]);

  const reviews: ReviewSubmission[] = reviewsResponse.data
    .filter((review) => review.state !== 'PENDING')
    .map((review) => ({
      author: review.user?.login ?? '',
      state: review.state,
      body: review.body ?? '',
    }));

  const inlineComments: ReviewInlineComment[] = commentsResponse.data.map((comment) => ({
    path: comment.path,
    line: comment.line ?? null,
    author: comment.user?.login ?? '',
    body: comment.body ?? '',
  }));

  return { reviews, inlineComments };
}

async function resolveReviewID(
  deps: RevisionReaderDeps,
  pullNumber: number,
): Promise<string | null> {
  const response = await retryWithBackoff(() =>
    deps.client.pulls.listReviews({
      owner: deps.config.owner,
      repo: deps.config.repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
  );

  const botReviews = response.data
    .filter((review) => review.state !== 'PENDING')
    .filter((review) => review.user !== null && review.user.login === deps.config.botUsername);

  if (botReviews.length === 0) {
    return null;
  }

  const sorted = [...botReviews].sort((a, b) => {
    const dateA = a.submitted_at ?? '';
    const dateB = b.submitted_at ?? '';
    return dateB.localeCompare(dateA);
  });

  invariant(sorted[0], 'sorted bot reviews must have at least one entry after length check');
  return String(sorted[0].id);
}

async function resolvePipeline(
  deps: RevisionReaderDeps,
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
        deps.client.repos.getCombinedStatusForRef({
          owner: deps.config.owner,
          repo: deps.config.repo,
          ref: pr.head.sha,
        }),
      ),
      retryWithBackoff(() =>
        deps.client.checks.listForRef({
          owner: deps.config.owner,
          repo: deps.config.repo,
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

interface FileItem {
  filename: string;
  status: string;
  patch?: string;
}

function mapFileToRevisionFile(file: FileItem): RevisionFile {
  return {
    path: file.filename,
    status: VALID_FILE_STATUSES[file.status] ?? 'changed',
    patch: file.patch ?? null,
  };
}
