import { expect, test, vi } from 'vitest';
import type { WorkItemReaderConfig, WorkItemReaderOctokit } from './create-work-item-reader.ts';
import { createWorkItemReader } from './create-work-item-reader.ts';

function buildOctokit(overrides?: Partial<WorkItemReaderOctokit>): WorkItemReaderOctokit {
  return {
    issues: {
      listForRepo: overrides?.issues?.listForRepo ?? vi.fn().mockResolvedValue({ data: [] }),
      get: overrides?.issues?.get ?? vi.fn().mockResolvedValue({ data: buildIssueData() }),
    },
    pulls: {
      list: overrides?.pulls?.list ?? vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

function buildConfig(): WorkItemReaderConfig {
  return { owner: 'test-owner', repo: 'test-repo' };
}

interface IssueOverrides {
  number?: number;
  title?: string;
  labels?: (string | { name?: string })[];
  body?: string | null;
  created_at?: string;
}

function buildIssueData(overrides?: IssueOverrides): {
  number: number;
  title: string;
  labels: (string | { name?: string })[];
  body: string | null;
  created_at: string;
} {
  return {
    number: overrides?.number ?? 1,
    title: overrides?.title ?? 'Test issue',
    labels: overrides?.labels ?? ['task:implement', 'status:pending'],
    body: overrides?.body === undefined ? 'Issue body' : overrides.body,
    created_at: overrides?.created_at ?? '2026-01-01T00:00:00Z',
  };
}

interface PROverrides {
  number?: number;
  body?: string | null;
}

function buildPRData(overrides?: PROverrides): { number: number; body: string | null } {
  return {
    number: overrides?.number ?? 10,
    body: overrides?.body === undefined ? 'Closes #1' : overrides.body,
  };
}

function setupTest(overrides?: {
  issues?: IssueOverrides[];
  prs?: PROverrides[];
  getIssue?: IssueOverrides;
  getIssueError?: { status: number };
}): {
  reader: ReturnType<typeof createWorkItemReader>;
  octokit: WorkItemReaderOctokit;
} {
  const issuesList = (overrides?.issues ?? []).map((i) => buildIssueData(i));
  const prsList = (overrides?.prs ?? []).map((p) => buildPRData(p));

  const issuesGet = overrides?.getIssueError
    ? vi.fn().mockRejectedValue(overrides.getIssueError)
    : vi.fn().mockResolvedValue({ data: buildIssueData(overrides?.getIssue) });

  const octokit = buildOctokit({
    issues: {
      listForRepo: vi.fn().mockResolvedValue({ data: issuesList }),
      get: issuesGet,
    },
    pulls: {
      list: vi.fn().mockResolvedValue({ data: prsList }),
    },
  });

  const reader = createWorkItemReader(octokit, buildConfig());
  return { reader, octokit };
}

// --- listWorkItems ---

test('it returns open issues with task:implement label as work items', async () => {
  const { reader } = setupTest({
    issues: [{ number: 1, labels: ['task:implement', 'status:pending'] }],
  });

  const result = await reader.listWorkItems();

  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe('1');
});

test('it excludes issues with task:refinement label', async () => {
  const { reader } = setupTest({
    issues: [
      { number: 1, labels: ['task:implement', 'task:refinement', 'status:pending'] },
      { number: 2, labels: ['task:implement', 'status:pending'] },
    ],
  });

  const result = await reader.listWorkItems();

  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe('2');
});

test('it resolves linked revision by cross-referencing open pull requests', async () => {
  const { reader } = setupTest({
    issues: [{ number: 5, labels: ['task:implement'] }],
    prs: [{ number: 3, body: 'Closes #5' }],
  });

  const result = await reader.listWorkItems();

  expect(result[0]?.linkedRevision).toBe('3');
});

test('it uses the lowest PR number when multiple PRs reference the same issue', async () => {
  const { reader } = setupTest({
    issues: [{ number: 5, labels: ['task:implement'] }],
    prs: [
      { number: 7, body: 'Closes #5' },
      { number: 3, body: 'Fixes #5' },
    ],
  });

  const result = await reader.listWorkItems();

  expect(result[0]?.linkedRevision).toBe('3');
});

test('it sets linked revision to null when no PR references the issue', async () => {
  const { reader } = setupTest({
    issues: [{ number: 5, labels: ['task:implement'] }],
    prs: [{ number: 3, body: 'Closes #99' }],
  });

  const result = await reader.listWorkItems();

  expect(result[0]?.linkedRevision).toBeNull();
});

test('it returns domain types without GitHub-specific fields', async () => {
  const { reader } = setupTest({
    issues: [
      {
        number: 10,
        title: 'Test task',
        labels: ['task:implement', 'status:review', 'priority:high', 'complexity:medium'],
        body: 'Body\n\n<!-- decree:blockedBy #7 #8 -->',
        created_at: '2026-01-15T08:00:00Z',
      },
    ],
  });

  const result = await reader.listWorkItems();

  expect(result[0]).toStrictEqual({
    id: '10',
    title: 'Test task',
    status: 'review',
    priority: 'high',
    complexity: 'medium',
    blockedBy: ['7', '8'],
    createdAt: '2026-01-15T08:00:00Z',
    linkedRevision: null,
  });
});

test('it wraps list API calls with retry', async () => {
  const listForRepo = vi.fn().mockResolvedValue({ data: [] });
  const pullsList = vi.fn().mockResolvedValue({ data: [] });

  const octokit = buildOctokit({
    issues: { listForRepo, get: vi.fn() },
    pulls: { list: pullsList },
  });

  const reader = createWorkItemReader(octokit, buildConfig());
  await reader.listWorkItems();

  expect(listForRepo).toHaveBeenCalledTimes(1);
  expect(pullsList).toHaveBeenCalledTimes(1);
});

// --- getWorkItem ---

test('it returns a single work item by id', async () => {
  const { reader } = setupTest({
    getIssue: { number: 42, title: 'Single issue' },
  });

  const result = await reader.getWorkItem('42');

  expect(result).not.toBeNull();
  expect(result?.id).toBe('42');
  expect(result?.title).toBe('Single issue');
});

test('it returns null when issue is not found', async () => {
  const { reader } = setupTest({
    getIssueError: { status: 404 },
  });

  const result = await reader.getWorkItem('999');

  expect(result).toBeNull();
});

test('it propagates non-404 errors from get', async () => {
  const { reader } = setupTest({
    getIssueError: { status: 422 },
  });

  await expect(reader.getWorkItem('1')).rejects.toMatchObject({ status: 422 });
});

test('it returns work item regardless of state or labels for get', async () => {
  const { reader } = setupTest({
    getIssue: { number: 5, labels: ['task:refinement', 'status:closed'] },
  });

  const result = await reader.getWorkItem('5');

  expect(result).not.toBeNull();
  expect(result?.id).toBe('5');
});

// --- getWorkItemBody ---

test('it returns the body content with dependency metadata stripped', async () => {
  const { reader } = setupTest({
    getIssue: { body: 'Main content\n\n<!-- decree:blockedBy #42 #43 -->' },
  });

  const result = await reader.getWorkItemBody('1');

  expect(result).toBe('Main content');
});

test('it returns plain body when no dependency metadata exists', async () => {
  const { reader } = setupTest({
    getIssue: { body: 'Just the content' },
  });

  const result = await reader.getWorkItemBody('1');

  expect(result).toBe('Just the content');
});

test('it throws on 404 for body fetch', async () => {
  const { reader } = setupTest({
    getIssueError: { status: 404 },
  });

  await expect(reader.getWorkItemBody('999')).rejects.toMatchObject({ status: 404 });
});

test('it coerces null body to empty string for body fetch', async () => {
  const { reader } = setupTest({
    getIssue: { body: null },
  });

  const result = await reader.getWorkItemBody('1');

  expect(result).toBe('');
});
