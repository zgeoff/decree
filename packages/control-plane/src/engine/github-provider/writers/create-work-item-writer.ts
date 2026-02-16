import type { GitHubClient } from '../../github-client/types.ts';
import type { WorkItem, WorkItemStatus } from '../../state-store/domain-type-stubs.ts';
import { formatDependencyMetadata } from '../mapping/format-dependency-metadata.ts';
import type { GitHubIssueInput } from '../mapping/map-issue-to-work-item.ts';
import { mapIssueToWorkItem } from '../mapping/map-issue-to-work-item.ts';
import { stripDependencyMetadata } from '../mapping/strip-dependency-metadata.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { WorkProviderWriter } from '../types.ts';

export interface WorkItemWriterConfig {
  owner: string;
  repo: string;
}

export interface WorkItemWriterDeps {
  client: GitHubClient;
  config: WorkItemWriterConfig;
}

export function createWorkItemWriter(deps: WorkItemWriterDeps): WorkProviderWriter {
  return {
    transitionStatus: async (workItemID: string, newStatus: WorkItemStatus): Promise<void> => {
      await transitionStatus(deps, workItemID, newStatus);
    },
    createWorkItem: async (
      title: string,
      body: string,
      labels: string[],
      blockedBy: string[],
    ): Promise<WorkItem> => createWorkItem({ deps, title, body, labels, blockedBy }),
    updateWorkItem: async (
      workItemID: string,
      body: string | null,
      labels: string[] | null,
    ): Promise<void> => {
      await updateWorkItem(deps, workItemID, body, labels);
    },
  };
}

// --- Helpers ---

const STATUS_PREFIX = 'status:';
const TASK_PREFIX = 'task:';

async function transitionStatus(
  deps: WorkItemWriterDeps,
  workItemID: string,
  newStatus: WorkItemStatus,
): Promise<void> {
  const issueNumber = Number(workItemID);

  const labelsResponse = await retryWithBackoff(() =>
    deps.client.issues.listLabelsOnIssue({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
      per_page: 100,
    }),
  );

  for (const label of labelsResponse.data) {
    const labelName = label.name;
    if (labelName?.startsWith(STATUS_PREFIX)) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential label removal required — labels may conflict if removed concurrently
      await retryWithBackoff(() =>
        deps.client.issues.removeLabel({
          owner: deps.config.owner,
          repo: deps.config.repo,
          issue_number: issueNumber,
          name: labelName,
        }),
      );
    }
  }

  await retryWithBackoff(() =>
    deps.client.issues.addLabels({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
      labels: [`${STATUS_PREFIX}${newStatus}`],
    }),
  );

  if (newStatus === 'closed') {
    await retryWithBackoff(() =>
      deps.client.issues.update({
        owner: deps.config.owner,
        repo: deps.config.repo,
        issue_number: issueNumber,
        state: 'closed',
      }),
    );
  }
}

interface CreateWorkItemParams {
  deps: WorkItemWriterDeps;
  title: string;
  body: string;
  labels: string[];
  blockedBy: string[];
}

async function createWorkItem(params: CreateWorkItemParams): Promise<WorkItem> {
  const fullBody = formatDependencyMetadata(params.body, params.blockedBy);
  const allLabels = ['task:implement', ...params.labels];

  const response = await retryWithBackoff(() =>
    params.deps.client.issues.create({
      owner: params.deps.config.owner,
      repo: params.deps.config.repo,
      title: params.title,
      body: fullBody,
      labels: allLabels,
    }),
  );

  const issueInput: GitHubIssueInput = {
    number: response.data.number,
    title: response.data.title,
    labels: response.data.labels,
    body: response.data.body,
    created_at: response.data.created_at,
  };

  return mapIssueToWorkItem(issueInput, { linkedRevision: null });
}

async function updateWorkItem(
  deps: WorkItemWriterDeps,
  workItemID: string,
  body: string | null,
  labels: string[] | null,
): Promise<void> {
  const issueNumber = Number(workItemID);

  if (body !== null) {
    await updateWorkItemBody(deps, issueNumber, body);
  }

  if (labels !== null) {
    await updateWorkItemLabels(deps, issueNumber, labels);
  }
}

async function updateWorkItemBody(
  deps: WorkItemWriterDeps,
  issueNumber: number,
  newBody: string,
): Promise<void> {
  const response = await retryWithBackoff(() =>
    deps.client.issues.get({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
    }),
  );

  const currentBody = response.data.body ?? '';
  const strippedCurrent = stripDependencyMetadata(currentBody);
  const metadataSuffix = currentBody.slice(strippedCurrent.length);

  const updatedBody = newBody + metadataSuffix;

  await retryWithBackoff(() =>
    deps.client.issues.update({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
      body: updatedBody,
    }),
  );
}

async function updateWorkItemLabels(
  deps: WorkItemWriterDeps,
  issueNumber: number,
  newLabels: string[],
): Promise<void> {
  const labelsResponse = await retryWithBackoff(() =>
    deps.client.issues.listLabelsOnIssue({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
      per_page: 100,
    }),
  );

  const reservedLabels: string[] = [];

  for (const label of labelsResponse.data) {
    if (
      label.name !== undefined &&
      (label.name.startsWith(STATUS_PREFIX) || label.name.startsWith(TASK_PREFIX))
    ) {
      reservedLabels.push(label.name);
    }
  }

  const combinedLabels = [...reservedLabels, ...newLabels];

  await retryWithBackoff(() =>
    deps.client.issues.update({
      owner: deps.config.owner,
      repo: deps.config.repo,
      issue_number: issueNumber,
      labels: combinedLabels,
    }),
  );
}
