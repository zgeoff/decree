import { expect, test } from 'vitest';
import type { GitHubPRInput, MapPROptions } from './map-pr-to-revision.ts';
import { mapPRToRevision } from './map-pr-to-revision.ts';

function buildPR(overrides?: Partial<GitHubPRInput>): GitHubPRInput {
  return {
    number: overrides?.number ?? 1,
    title: overrides?.title ?? 'Test PR',
    html_url: overrides?.html_url ?? 'https://github.com/owner/repo/pull/1',
    head: overrides?.head ?? { sha: 'abc123', ref: 'feature-branch' },
    user: overrides?.user === undefined ? { login: 'testuser' } : overrides.user,
    body: overrides?.body === undefined ? 'Closes #10' : overrides.body,
    ...(overrides?.draft !== undefined ? { draft: overrides.draft } : {}),
  };
}

function buildOptions(overrides?: Partial<MapPROptions>): MapPROptions {
  return {
    pipeline: overrides?.pipeline ?? null,
    reviewID: overrides?.reviewID ?? null,
  };
}

test('it maps PR number to revision id as a string', () => {
  const pr = buildPR({ number: 42 });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.id).toBe('42');
});

test('it maps PR title to revision title', () => {
  const pr = buildPR({ title: 'feat: add login' });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.title).toBe('feat: add login');
});

test('it maps PR html_url to revision url', () => {
  const pr = buildPR({ html_url: 'https://github.com/o/r/pull/5' });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.url).toBe('https://github.com/o/r/pull/5');
});

test('it maps head sha and ref to revision fields', () => {
  const pr = buildPR({ head: { sha: 'def456', ref: 'my-branch' } });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.headSHA).toBe('def456');
  expect(result.headRef).toBe('my-branch');
});

test('it maps user login to author', () => {
  const pr = buildPR({ user: { login: 'octocat' } });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.author).toBe('octocat');
});

test('it coerces null body to empty string', () => {
  const pr = buildPR({ body: null });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.body).toBe('');
});

test('it coerces missing user to empty author', () => {
  const pr = buildPR({ user: null });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.author).toBe('');
});

test('it coerces missing draft to false', () => {
  const pr = buildPR();
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.isDraft).toBe(false);
});

test('it maps draft to isDraft when true', () => {
  const pr = buildPR({ draft: true });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.isDraft).toBe(true);
});

test('it resolves workItemID via closing keyword in PR body', () => {
  const pr = buildPR({ body: 'Closes #10' });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.workItemID).toBe('10');
});

test('it resolves workItemID from lowercase closing keyword', () => {
  const pr = buildPR({ body: 'fixes #25' });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.workItemID).toBe('25');
});

test('it returns null workItemID when no closing keyword exists', () => {
  const pr = buildPR({ body: 'Just a description' });
  const result = mapPRToRevision(pr, buildOptions());
  expect(result.workItemID).toBeNull();
});

test('it passes through pipeline from options', () => {
  const pipeline = { status: 'success' as const, url: null, reason: null };
  const result = mapPRToRevision(buildPR(), buildOptions({ pipeline }));
  expect(result.pipeline).toStrictEqual(pipeline);
});

test('it passes through reviewID from options', () => {
  const result = mapPRToRevision(buildPR(), buildOptions({ reviewID: '123' }));
  expect(result.reviewID).toBe('123');
});

test('it returns a complete revision with all fields mapped', () => {
  const pr = buildPR({
    number: 7,
    title: 'fix: auth bug',
    html_url: 'https://github.com/o/r/pull/7',
    head: { sha: 'sha789', ref: 'fix-auth' },
    user: { login: 'dev' },
    body: 'Resolves #3',
    draft: true,
  });
  const options = buildOptions({
    pipeline: { status: 'failure', url: 'https://ci.example.com/1', reason: 'lint' },
    reviewID: '456',
  });

  const result = mapPRToRevision(pr, options);
  expect(result).toStrictEqual({
    id: '7',
    title: 'fix: auth bug',
    url: 'https://github.com/o/r/pull/7',
    headSHA: 'sha789',
    headRef: 'fix-auth',
    author: 'dev',
    body: 'Resolves #3',
    isDraft: true,
    workItemID: '3',
    pipeline: { status: 'failure', url: 'https://ci.example.com/1', reason: 'lint' },
    reviewID: '456',
  });
});
