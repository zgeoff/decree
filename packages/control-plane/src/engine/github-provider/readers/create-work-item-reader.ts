import type { WorkItem } from '../../state-store/domain-type-stubs.ts';
import type { GitHubIssueInput } from '../mapping/map-issue-to-work-item.ts';
import { mapIssueToWorkItem } from '../mapping/map-issue-to-work-item.ts';
import { matchClosingKeywords } from '../mapping/match-closing-keywords.ts';
import { stripDependencyMetadata } from '../mapping/strip-dependency-metadata.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { WorkProviderReader } from '../types.ts';

// --- Narrow Octokit interfaces ---

interface IssueResponse {
  data: GitHubIssueInput;
}

interface IssueListResponse {
  data: GitHubIssueInput[];
}

interface PRListItem {
  number: number;
  body: string | null;
}

interface PRListResponse {
  data: PRListItem[];
}

interface IssuesAPI {
  listForRepo: (params: IssueListParams) => Promise<IssueListResponse>;
  get: (params: IssueGetParams) => Promise<IssueResponse>;
}

interface PullsAPI {
  list: (params: PRListParams) => Promise<PRListResponse>;
}

interface IssueListParams {
  owner: string;
  repo: string;
  state: 'open';
  labels: string;
  per_page: number;
}

interface IssueGetParams {
  owner: string;
  repo: string;
  issue_number: number;
}

interface PRListParams {
  owner: string;
  repo: string;
  state: 'open';
  per_page: number;
}

export interface WorkItemReaderOctokit {
  issues: IssuesAPI;
  pulls: PullsAPI;
}

export interface WorkItemReaderConfig {
  owner: string;
  repo: string;
}

const STATUS_NOT_FOUND = 404;

export function createWorkItemReader(
  octokit: WorkItemReaderOctokit,
  config: WorkItemReaderConfig,
): WorkProviderReader {
  return {
    listWorkItems: async (): Promise<WorkItem[]> => {
      const [issuesResponse, prsResponse] = await Promise.all([
        retryWithBackoff(() =>
          octokit.issues.listForRepo({
            owner: config.owner,
            repo: config.repo,
            state: 'open',
            labels: 'task:implement',
            per_page: 100,
          }),
        ),
        retryWithBackoff(() =>
          octokit.pulls.list({
            owner: config.owner,
            repo: config.repo,
            state: 'open',
            per_page: 100,
          }),
        ),
      ]);

      const issues = issuesResponse.data;
      const prs = prsResponse.data;

      const prsByWorkItem = buildPRLookup(prs);

      const workItems: WorkItem[] = [];

      for (const issue of issues) {
        if (!hasLabel(issue, 'task:refinement')) {
          const linkedRevision = prsByWorkItem.get(String(issue.number)) ?? null;
          workItems.push(mapIssueToWorkItem(issue, { linkedRevision }));
        }
      }

      return workItems;
    },

    getWorkItem: async (id: string): Promise<WorkItem | null> => {
      try {
        const response = await retryWithBackoff(() =>
          octokit.issues.get({
            owner: config.owner,
            repo: config.repo,
            issue_number: Number(id),
          }),
        );

        return mapIssueToWorkItem(response.data, { linkedRevision: null });
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    getWorkItemBody: async (id: string): Promise<string> => {
      const response = await retryWithBackoff(() =>
        octokit.issues.get({
          owner: config.owner,
          repo: config.repo,
          issue_number: Number(id),
        }),
      );

      const body = response.data.body ?? '';
      return stripDependencyMetadata(body);
    },
  };
}

function buildPRLookup(prs: PRListItem[]): Map<string, string> {
  const lookup = new Map<string, string>();
  const sortedPRs = [...prs].sort((a, b) => a.number - b.number);

  for (const pr of sortedPRs) {
    const workItemID = matchClosingKeywords(pr.body ?? '');
    if (workItemID !== null && !lookup.has(workItemID)) {
      lookup.set(workItemID, String(pr.number));
    }
  }

  return lookup;
}

function hasLabel(issue: GitHubIssueInput, labelName: string): boolean {
  return issue.labels.some((label) => {
    if (typeof label === 'string') {
      return label === labelName;
    }
    return typeof label === 'object' && label !== null && label.name === labelName;
  });
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === STATUS_NOT_FOUND
  );
}
