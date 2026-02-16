import type { Complexity, Priority, WorkItemStatus } from '../../state-store/domain-type-stubs.ts';

export type GitHubLabel = string | { name?: string };

export interface ParsedLabels {
  status: WorkItemStatus;
  priority: Priority | null;
  complexity: Complexity | null;
}

const VALID_STATUSES: Record<string, WorkItemStatus> = {
  pending: 'pending',
  ready: 'ready',
  'in-progress': 'in-progress',
  review: 'review',
  approved: 'approved',
  closed: 'closed',
  'needs-refinement': 'needs-refinement',
  blocked: 'blocked',
};

const VALID_PRIORITIES: Record<string, Priority> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const VALID_COMPLEXITIES: Record<string, Complexity> = {
  trivial: 'trivial',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export function parseLabels(labels: GitHubLabel[]): ParsedLabels {
  const names = extractLabelNames(labels);

  const status = pickFirst(names, 'status:', VALID_STATUSES) ?? 'pending';
  const priority = pickFirst(names, 'priority:', VALID_PRIORITIES);
  const complexity = pickFirst(names, 'complexity:', VALID_COMPLEXITIES);

  return { status, priority, complexity };
}

function extractLabelNames(labels: GitHubLabel[]): string[] {
  const result: string[] = [];

  for (const label of labels) {
    if (typeof label === 'string') {
      result.push(label);
    } else if (typeof label === 'object' && label !== null && typeof label.name === 'string') {
      result.push(label.name);
    }
  }

  return result;
}

function pickFirst<T>(names: string[], prefix: string, validValues: Record<string, T>): T | null {
  const matches: T[] = [];

  for (const name of names) {
    if (name.startsWith(prefix)) {
      const value = name.slice(prefix.length);
      const mapped = validValues[value];
      if (mapped !== undefined) {
        matches.push(mapped);
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => String(a).localeCompare(String(b)));
  return matches[0] ?? null;
}
