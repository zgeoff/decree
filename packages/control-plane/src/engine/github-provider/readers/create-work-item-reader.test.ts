import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../../test-utils/create-mock-github-client.ts';
import type { IssueOverrides } from '../test-utils/build-issue-data.ts';
import { buildIssueData } from '../test-utils/build-issue-data.ts';
import type { WorkItemReaderConfig } from './create-work-item-reader.ts';
import { createWorkItemReader } from './create-work-item-reader.ts';

interface PROverrides {
  number?: number;
  body?: string | null;
}

function buildPRListItem(overrides?: PROverrides): {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  body: string | null;
  draft: boolean;
} {
  return {
    number: overrides?.number ?? 10,
    title: 'Test PR',
    html_url: 'https://github.com/owner/repo/pull/1',
    user: null,
    head: { sha: 'abc123', ref: 'branch' },
    body: overrides?.body === undefined ? 'Closes #1' : overrides.body,
    draft: false,
  };
}

function buildConfig(): WorkItemReaderConfig {
  return { owner: 'test-owner', repo: 'test-repo' };
}

function setupTest(overrides?: {
  issues?: IssueOverrides[];
  prs?: PROverrides[];
  getIssue?: IssueOverrides;
}): {
  reader: ReturnType<typeof createWorkItemReader>;
  client: ReturnType<typeof createMockGitHubClient>;
} {
  const issuesList = (overrides?.issues ?? []).map((i) => buildIssueData(i));
  const prsList = (overrides?.prs ?? []).map((p) => buildPRListItem(p));

  const client = createMockGitHubClient();

  vi.mocked(client.issues.listForRepo).mockResolvedValue({ data: issuesList });
  vi.mocked(client.pulls.list).mockResolvedValue({ data: prsList });
  vi.mocked(client.issues.get).mockResolvedValue({
    data: buildIssueData(overrides?.getIssue),
  });

  const reader = createWorkItemReader({ client, config: buildConfig() });
  return { reader, client };
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
  const client = createMockGitHubClient();
  vi.mocked(client.issues.listForRepo).mockResolvedValue({ data: [] });
  vi.mocked(client.pulls.list).mockResolvedValue({ data: [] });

  const reader = createWorkItemReader({ client, config: buildConfig() });
  await reader.listWorkItems();

  expect(client.issues.listForRepo).toHaveBeenCalledTimes(1);
  expect(client.pulls.list).toHaveBeenCalledTimes(1);
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
  const { reader, client } = setupTest();
  vi.mocked(client.issues.get).mockRejectedValue({ status: 404 });

  const result = await reader.getWorkItem('999');

  expect(result).toBeNull();
});

test('it propagates non-404 errors from get', async () => {
  const { reader, client } = setupTest();
  vi.mocked(client.issues.get).mockRejectedValue({ status: 422 });

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
  const { reader, client } = setupTest();
  vi.mocked(client.issues.get).mockRejectedValue({ status: 404 });

  await expect(reader.getWorkItemBody('999')).rejects.toMatchObject({ status: 404 });
});

test('it coerces null body to empty string for body fetch', async () => {
  const { reader } = setupTest({
    getIssue: { body: null },
  });

  const result = await reader.getWorkItemBody('1');

  expect(result).toBe('');
});
