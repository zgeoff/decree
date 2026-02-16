import type { GitHubClient } from '../../github-client/types.ts';
import type { WorkItem } from '../../state-store/domain-type-stubs.ts';
import { isNotFoundError } from '../is-not-found-error.ts';
import type { GitHubIssueInput } from '../mapping/map-issue-to-work-item.ts';
import { mapIssueToWorkItem } from '../mapping/map-issue-to-work-item.ts';
import { matchClosingKeywords } from '../mapping/match-closing-keywords.ts';
import { stripDependencyMetadata } from '../mapping/strip-dependency-metadata.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { WorkProviderReader } from '../types.ts';

export interface WorkItemReaderConfig {
  owner: string;
  repo: string;
}

export interface WorkItemReaderDeps {
  client: GitHubClient;
  config: WorkItemReaderConfig;
}

export function createWorkItemReader(deps: WorkItemReaderDeps): WorkProviderReader {
  return {
    listWorkItems: async (): Promise<WorkItem[]> => {
      const [issuesResponse, prsResponse] = await Promise.all([
        retryWithBackoff(() =>
          deps.client.issues.listForRepo({
            owner: deps.config.owner,
            repo: deps.config.repo,
            state: 'open',
            labels: 'task:implement',
            per_page: 100,
          }),
        ),
        retryWithBackoff(() =>
          deps.client.pulls.list({
            owner: deps.config.owner,
            repo: deps.config.repo,
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
          deps.client.issues.get({
            owner: deps.config.owner,
            repo: deps.config.repo,
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
        deps.client.issues.get({
          owner: deps.config.owner,
          repo: deps.config.repo,
          issue_number: Number(id),
        }),
      );

      const body = response.data.body ?? '';
      return stripDependencyMetadata(body);
    },
  };
}

interface PRLookupItem {
  number: number;
  body: string | null;
}

function buildPRLookup(prs: PRLookupItem[]): Map<string, string> {
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
