import { expect, test } from 'vitest';
import type { GitHubIssueInput } from './map-issue-to-work-item.ts';
import { mapIssueToWorkItem } from './map-issue-to-work-item.ts';

function buildIssue(overrides?: Partial<GitHubIssueInput>): GitHubIssueInput {
  return {
    number: overrides?.number ?? 1,
    title: overrides?.title ?? 'Test issue',
    labels: overrides?.labels ?? ['task:implement', 'status:pending'],
    body: overrides?.body ?? 'Issue body',
    created_at: overrides?.created_at ?? '2026-01-01T00:00:00Z',
  };
}

test('it maps issue number to work item id as a string', () => {
  const issue = buildIssue({ number: 42 });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.id).toBe('42');
});

test('it maps issue title to work item title', () => {
  const issue = buildIssue({ title: 'Implement feature X' });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.title).toBe('Implement feature X');
});

test('it parses status from labels', () => {
  const issue = buildIssue({ labels: ['status:in-progress'] });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.status).toBe('in-progress');
});

test('it parses priority from labels', () => {
  const issue = buildIssue({ labels: ['priority:medium'] });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.priority).toBe('medium');
});

test('it parses complexity from labels', () => {
  const issue = buildIssue({ labels: ['complexity:high'] });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.complexity).toBe('high');
});

test('it parses blocked-by from dependency metadata in the issue body', () => {
  const issue = buildIssue({ body: 'Body text\n\n<!-- decree:blockedBy #42 #43 -->' });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.blockedBy).toStrictEqual(['42', '43']);
});

test('it returns empty blocked-by when no dependency metadata exists', () => {
  const issue = buildIssue({ body: 'Plain body' });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.blockedBy).toStrictEqual([]);
});

test('it passes through the linked revision from options', () => {
  const issue = buildIssue();
  const result = mapIssueToWorkItem(issue, { linkedRevision: '5' });
  expect(result.linkedRevision).toBe('5');
});

test('it sets linked revision to null when not provided', () => {
  const issue = buildIssue();
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.linkedRevision).toBeNull();
});

test('it maps created_at to the work item', () => {
  const issue = buildIssue({ created_at: '2026-02-15T12:00:00Z' });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.createdAt).toBe('2026-02-15T12:00:00Z');
});

test('it coerces null body to empty string for dependency parsing', () => {
  const issue = buildIssue({ body: null });
  const result = mapIssueToWorkItem(issue, { linkedRevision: null });
  expect(result.blockedBy).toStrictEqual([]);
});

test('it returns a complete work item with all fields mapped', () => {
  const issue = buildIssue({
    number: 10,
    title: 'Full test',
    labels: ['status:review', 'priority:high', 'complexity:low'],
    body: 'Content\n\n<!-- decree:blockedBy #7 -->',
    created_at: '2026-01-15T08:30:00Z',
  });

  const result = mapIssueToWorkItem(issue, { linkedRevision: '3' });
  expect(result).toStrictEqual({
    id: '10',
    title: 'Full test',
    status: 'review',
    priority: 'high',
    complexity: 'low',
    blockedBy: ['7'],
    createdAt: '2026-01-15T08:30:00Z',
    linkedRevision: '3',
  });
});
