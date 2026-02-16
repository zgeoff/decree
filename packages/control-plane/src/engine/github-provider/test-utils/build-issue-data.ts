export interface IssueOverrides {
  number?: number;
  title?: string;
  labels?: (string | { name?: string })[];
  body?: string | null;
  created_at?: string;
}

interface IssueData {
  number: number;
  title: string;
  labels: (string | { name?: string })[];
  body: string | null;
  created_at: string;
}

export function buildIssueData(overrides?: IssueOverrides): IssueData {
  return {
    number: overrides?.number ?? 1,
    title: overrides?.title ?? 'Test issue',
    labels: overrides?.labels ?? ['task:implement', 'status:pending'],
    body: overrides?.body === undefined ? 'Issue body' : overrides.body,
    created_at: overrides?.created_at ?? '2026-01-01T00:00:00Z',
  };
}
