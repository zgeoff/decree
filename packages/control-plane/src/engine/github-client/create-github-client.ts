import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import invariant from 'tiny-invariant';
import type {
  AppsGetAuthenticatedResult,
  ChecksListForRefParams,
  ChecksListForRefResult,
  GitCreateBlobParams,
  GitCreateBlobResult,
  GitCreateCommitParams,
  GitCreateCommitResult,
  GitCreateRefParams,
  GitCreateRefResult,
  GitCreateTreeParams,
  GitCreateTreeResult,
  GitGetBlobParams,
  GitGetBlobResult,
  GitGetCommitParams,
  GitGetCommitResult,
  GitGetRefParams,
  GitGetRefResult,
  GitGetTreeParams,
  GitGetTreeResult,
  GitHubClient,
  GitHubClientConfig,
  GitUpdateRefParams,
  GitUpdateRefResult,
  IssuesAddLabelsParams,
  IssuesAddLabelsResult,
  IssuesCreateCommentParams,
  IssuesCreateCommentResult,
  IssuesCreateParams,
  IssuesCreateResult,
  IssuesGetParams,
  IssuesGetResult,
  IssuesListForRepoParams,
  IssuesListForRepoResult,
  IssuesListLabelsOnIssueParams,
  IssuesListLabelsOnIssueResult,
  IssuesRemoveLabelParams,
  IssuesRemoveLabelResult,
  IssuesUpdateParams,
  IssuesUpdateResult,
  PullReview,
  PullsCreateParams,
  PullsCreateResult,
  PullsCreateReviewParams,
  PullsCreateReviewResult,
  PullsDismissReviewParams,
  PullsDismissReviewResult,
  PullsGetParams,
  PullsGetResult,
  PullsListFilesParams,
  PullsListFilesResult,
  PullsListParams,
  PullsListResult,
  PullsListReviewCommentsParams,
  PullsListReviewCommentsResult,
  PullsListReviewsParams,
  PullsListReviewsResult,
  PullsUpdateParams,
  PullsUpdateResult,
  ReposGetCombinedStatusParams,
  ReposGetCombinedStatusResult,
  ReposGetContentParams,
  ReposGetContentResult,
} from './types.ts';

export function createGitHubClient(config: GitHubClientConfig): GitHubClient {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appID,
      privateKey: config.privateKey,
      installationId: config.installationID,
    },
  });

  return {
    apps: {
      async getAuthenticated(): Promise<AppsGetAuthenticatedResult> {
        const response = await octokit.apps.getAuthenticated();
        invariant(response.data, 'apps.getAuthenticated must return data');
        return {
          data: {
            slug: response.data.slug ?? '',
          },
        };
      },
    },

    issues: {
      async get(params: IssuesGetParams): Promise<IssuesGetResult> {
        const response = await octokit.issues.get(params);
        return {
          data: {
            number: response.data.number,
            title: response.data.title,
            body: response.data.body ?? null,
            labels: response.data.labels,
            created_at: response.data.created_at,
          },
        };
      },

      async listForRepo(params: IssuesListForRepoParams): Promise<IssuesListForRepoResult> {
        const response = await octokit.issues.listForRepo(params);
        return {
          data: response.data.map((issue) => ({
            number: issue.number,
            title: issue.title,
            body: issue.body ?? null,
            labels: issue.labels,
            created_at: issue.created_at,
          })),
        };
      },

      async create(params: IssuesCreateParams): Promise<IssuesCreateResult> {
        const response = await octokit.issues.create(params);
        return {
          data: {
            number: response.data.number,
            title: response.data.title,
            body: response.data.body ?? null,
            labels: response.data.labels,
            created_at: response.data.created_at,
          },
        };
      },

      async update(params: IssuesUpdateParams): Promise<IssuesUpdateResult> {
        const response = await octokit.issues.update(params);
        return {
          data: {
            number: response.data.number,
            title: response.data.title,
            body: response.data.body ?? null,
            labels: response.data.labels,
            created_at: response.data.created_at,
          },
        };
      },

      async listLabelsOnIssue(
        params: IssuesListLabelsOnIssueParams,
      ): Promise<IssuesListLabelsOnIssueResult> {
        const response = await octokit.issues.listLabelsOnIssue(params);
        return {
          data: response.data.map((label) => ({
            name: label.name,
          })),
        };
      },

      async addLabels(params: IssuesAddLabelsParams): Promise<IssuesAddLabelsResult> {
        const response = await octokit.issues.addLabels(params);
        return { data: response.data };
      },

      async removeLabel(params: IssuesRemoveLabelParams): Promise<IssuesRemoveLabelResult> {
        const response = await octokit.issues.removeLabel(params);
        return { data: response.data };
      },

      async createComment(params: IssuesCreateCommentParams): Promise<IssuesCreateCommentResult> {
        const response = await octokit.issues.createComment(params);
        return { data: response.data };
      },
    },

    pulls: {
      async list(params: PullsListParams): Promise<PullsListResult> {
        const response = await octokit.pulls.list(params);
        return {
          data: response.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            user: pr.user,
            head: {
              sha: pr.head.sha,
              ref: pr.head.ref,
            },
            body: pr.body,
            draft: pr.draft ?? false,
          })),
        };
      },

      async get(params: PullsGetParams): Promise<PullsGetResult> {
        const response = await octokit.pulls.get(params);
        return {
          data: {
            number: response.data.number,
            title: response.data.title,
            changed_files: response.data.changed_files,
            html_url: response.data.html_url,
            user: response.data.user,
            head: { sha: response.data.head.sha, ref: response.data.head.ref },
            body: response.data.body,
            draft: response.data.draft ?? false,
          },
        };
      },

      async listFiles(params: PullsListFilesParams): Promise<PullsListFilesResult> {
        const response = await octokit.pulls.listFiles(params);
        return {
          data: response.data.map((file) => {
            const entry: { filename: string; status: string; patch?: string } = {
              filename: file.filename,
              status: file.status,
            };
            if (file.patch !== undefined) {
              entry.patch = file.patch;
            }
            return entry;
          }),
        };
      },

      async listReviews(params: PullsListReviewsParams): Promise<PullsListReviewsResult> {
        const response = await octokit.pulls.listReviews(params);
        return {
          data: response.data.map((review) => buildPullReview(review)),
        };
      },

      async listReviewComments(
        params: PullsListReviewCommentsParams,
      ): Promise<PullsListReviewCommentsResult> {
        const response = await octokit.pulls.listReviewComments(params);
        return {
          data: response.data.map((comment) => ({
            id: comment.id,
            user: comment.user,
            body: comment.body,
            path: comment.path,
            line: comment.line ?? null,
          })),
        };
      },

      async create(params: PullsCreateParams): Promise<PullsCreateResult> {
        const response = await octokit.pulls.create(params);
        return {
          data: {
            number: response.data.number,
            title: response.data.title,
            html_url: response.data.html_url,
            user: response.data.user,
            head: {
              sha: response.data.head.sha,
              ref: response.data.head.ref,
            },
            body: response.data.body,
            draft: response.data.draft ?? false,
          },
        };
      },

      async update(params: PullsUpdateParams): Promise<PullsUpdateResult> {
        const response = await octokit.pulls.update(params);
        return { data: response.data };
      },

      async createReview(params: PullsCreateReviewParams): Promise<PullsCreateReviewResult> {
        const response = await octokit.pulls.createReview(params);
        return {
          data: {
            id: response.data.id,
          },
        };
      },

      async dismissReview(params: PullsDismissReviewParams): Promise<PullsDismissReviewResult> {
        const response = await octokit.pulls.dismissReview(params);
        return { data: response.data };
      },
    },

    repos: {
      async getCombinedStatusForRef(
        params: ReposGetCombinedStatusParams,
      ): Promise<ReposGetCombinedStatusResult> {
        const response = await octokit.repos.getCombinedStatusForRef(params);
        return {
          data: {
            state: response.data.state,
            total_count: response.data.total_count,
          },
        };
      },

      async getContent(params: ReposGetContentParams): Promise<ReposGetContentResult> {
        const response = await octokit.repos.getContent(params);
        const data = response.data;
        if ('content' in data && data.content !== undefined) {
          return { data: { sha: data.sha, content: data.content } };
        }
        if ('sha' in data && data.sha !== undefined) {
          return { data: { sha: data.sha } };
        }
        return { data: {} };
      },
    },

    checks: {
      async listForRef(params: ChecksListForRefParams): Promise<ChecksListForRefResult> {
        const response = await octokit.checks.listForRef(params);
        return {
          data: {
            total_count: response.data.total_count,
            check_runs: response.data.check_runs.map((run) => ({
              name: run.name,
              status: run.status,
              conclusion: run.conclusion,
              details_url: run.details_url ?? null,
            })),
          },
        };
      },
    },

    git: {
      async getTree(params: GitGetTreeParams): Promise<GitGetTreeResult> {
        const response = await octokit.git.getTree(params);
        return {
          data: {
            sha: response.data.sha,
            tree: response.data.tree.map((entry) => ({
              path: entry.path,
              sha: entry.sha,
              type: entry.type,
            })),
          },
        };
      },

      async getRef(params: GitGetRefParams): Promise<GitGetRefResult> {
        const response = await octokit.git.getRef(params);
        return {
          data: {
            object: { sha: response.data.object.sha },
          },
        };
      },

      async getBlob(params: GitGetBlobParams): Promise<GitGetBlobResult> {
        const response = await octokit.git.getBlob(params);
        return {
          data: {
            content: response.data.content,
            encoding: response.data.encoding,
          },
        };
      },

      async getCommit(params: GitGetCommitParams): Promise<GitGetCommitResult> {
        const response = await octokit.git.getCommit(params);
        return {
          data: {
            sha: response.data.sha,
            tree: { sha: response.data.tree.sha },
          },
        };
      },

      async createBlob(params: GitCreateBlobParams): Promise<GitCreateBlobResult> {
        const response = await octokit.git.createBlob(params);
        return {
          data: {
            sha: response.data.sha,
          },
        };
      },

      async createTree(params: GitCreateTreeParams): Promise<GitCreateTreeResult> {
        const response = await octokit.git.createTree(params);
        return {
          data: {
            sha: response.data.sha,
          },
        };
      },

      async createCommit(params: GitCreateCommitParams): Promise<GitCreateCommitResult> {
        const response = await octokit.git.createCommit(params);
        return {
          data: {
            sha: response.data.sha,
          },
        };
      },

      async createRef(params: GitCreateRefParams): Promise<GitCreateRefResult> {
        const response = await octokit.git.createRef(params);
        return { data: response.data };
      },

      async updateRef(params: GitUpdateRefParams): Promise<GitUpdateRefResult> {
        const response = await octokit.git.updateRef(params);
        return { data: response.data };
      },
    },
  };
}

// --- Helpers ---

interface OctokitReviewData {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string;
  submitted_at?: string;
}

function buildPullReview(review: OctokitReviewData): PullReview {
  const result: PullReview = {
    id: review.id,
    user: review.user,
    state: review.state,
    body: review.body,
  };

  if (review.submitted_at !== undefined) {
    result.submitted_at = review.submitted_at;
  }

  return result;
}
