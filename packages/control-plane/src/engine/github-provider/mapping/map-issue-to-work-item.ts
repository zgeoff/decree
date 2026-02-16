import type { WorkItem } from '../../state-store/domain-type-stubs.ts';
import { parseDependencyMetadata } from './parse-dependency-metadata.ts';
import { parseLabels } from './parse-labels.ts';

type GitHubLabel = string | { name?: string };

interface GitHubIssueInput {
  number: number;
  title: string;
  labels: GitHubLabel[];
  body: string | null;
  created_at: string;
}

interface MapIssueOptions {
  linkedRevision: string | null;
}

export function mapIssueToWorkItem(issue: GitHubIssueInput, options: MapIssueOptions): WorkItem {
  const labels = parseLabels(issue.labels);
  const body = issue.body ?? '';
  const blockedBy = parseDependencyMetadata(body);

  return {
    id: String(issue.number),
    title: issue.title,
    status: labels.status,
    priority: labels.priority,
    complexity: labels.complexity,
    blockedBy,
    createdAt: issue.created_at,
    linkedRevision: options.linkedRevision,
  };
}
