import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../../test-utils/create-mock-github-client.ts';
import type { CheckRunOverrides } from '../test-utils/build-check-run.ts';
import { buildCheckRun } from '../test-utils/build-check-run.ts';
import { buildCombinedStatus } from '../test-utils/build-combined-status.ts';
import type { PROverrides } from '../test-utils/build-pr-data.ts';
import { buildPRData } from '../test-utils/build-pr-data.ts';
import type { ReviewOverrides } from '../test-utils/build-review-data.ts';
import { buildReviewData } from '../test-utils/build-review-data.ts';
import type { RevisionReaderConfig } from './create-revision-reader.ts';
import { createRevisionReader } from './create-revision-reader.ts';

function buildConfig(): RevisionReaderConfig {
  return { owner: 'test-owner', repo: 'test-repo', botUsername: 'decree-bot[bot]' };
}

interface SetupOverrides {
  prs?: PROverrides[];
  reviews?: ReviewOverrides[];
  combinedState?: string;
  combinedTotalCount?: number;
  checkRuns?: CheckRunOverrides[];
  checkRunsTotalCount?: number;
  getPR?: PROverrides;
  files?: { filename: string; status: string; patch?: string }[];
}

function setupTest(overrides?: SetupOverrides): {
  reader: ReturnType<typeof createRevisionReader>;
  client: ReturnType<typeof createMockGitHubClient>;
} {
  const prsList = (overrides?.prs ?? []).map((p) => buildPRData(p));
  const reviewsList = (overrides?.reviews ?? []).map((r) => buildReviewData(r));
  const checkRunsList = (overrides?.checkRuns ?? []).map((c) => buildCheckRun(c));

  const client = createMockGitHubClient();

  vi.mocked(client.pulls.list).mockResolvedValue({ data: prsList });
  vi.mocked(client.pulls.listReviews).mockResolvedValue({ data: reviewsList });

  vi.mocked(client.pulls.get).mockResolvedValue({ data: buildPRData(overrides?.getPR) });
  vi.mocked(client.pulls.listFiles).mockResolvedValue({ data: overrides?.files ?? [] });
  vi.mocked(client.repos.getCombinedStatusForRef).mockResolvedValue({
    data: buildCombinedStatus(
      overrides?.combinedState ?? 'success',
      overrides?.combinedTotalCount ?? 1,
    ),
  });
  vi.mocked(client.checks.listForRef).mockResolvedValue({
    data: {
      total_count: overrides?.checkRunsTotalCount ?? checkRunsList.length,
      check_runs: checkRunsList,
    },
  });

  const reader = createRevisionReader({ client, config: buildConfig() });
  return { reader, client };
}

// --- listRevisions ---

test('it returns all open PRs including drafts mapped to revisions', async () => {
  const { reader } = setupTest({
    prs: [
      { number: 1, draft: false },
      { number: 2, draft: true },
    ],
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result).toHaveLength(2);
  expect(result[0]?.id).toBe('1');
  expect(result[1]?.id).toBe('2');
  expect(result[1]?.isDraft).toBe(true);
});

test('it populates work item ID via closing keyword matching in PR body', async () => {
  const { reader } = setupTest({
    prs: [{ number: 1, body: 'Closes #10' }],
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]?.workItemID).toBe('10');
});

test('it populates pipeline via CI status derivation', async () => {
  const { reader } = setupTest({
    prs: [{ number: 1 }],
    combinedState: 'success',
    combinedTotalCount: 1,
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]?.pipeline).toStrictEqual({ status: 'success', url: null, reason: null });
});

test('it populates review ID from bot-authored reviews', async () => {
  const { reader } = setupTest({
    prs: [{ number: 1 }],
    reviews: [{ id: 500, userLogin: 'decree-bot[bot]', submitted_at: '2026-01-01T00:00:00Z' }],
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]?.reviewID).toBe('500');
});

test('it uses the most recent bot review when multiple exist', async () => {
  const { reader } = setupTest({
    prs: [{ number: 1 }],
    reviews: [
      { id: 100, userLogin: 'decree-bot[bot]', submitted_at: '2026-01-01T00:00:00Z' },
      { id: 200, userLogin: 'decree-bot[bot]', submitted_at: '2026-01-02T00:00:00Z' },
    ],
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]?.reviewID).toBe('200');
});

test('it sets review ID to null when no bot-authored review exists', async () => {
  const { reader } = setupTest({
    prs: [{ number: 1 }],
    reviews: [{ id: 100, userLogin: 'human-user', submitted_at: '2026-01-01T00:00:00Z' }],
    checkRuns: [{ conclusion: 'success' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]?.reviewID).toBeNull();
});

test('it sets pipeline to null when CI status fetch fails after retries', async () => {
  const { reader, client } = setupTest({
    prs: [{ number: 1 }],
  });
  vi.mocked(client.repos.getCombinedStatusForRef).mockRejectedValue({ status: 403 });
  vi.mocked(client.checks.listForRef).mockRejectedValue({ status: 403 });

  const result = await reader.listRevisions();

  expect(result[0]?.pipeline).toBeNull();
  expect(result).toHaveLength(1);
});

test('it returns only domain types without GitHub-specific fields', async () => {
  const { reader } = setupTest({
    prs: [
      {
        number: 7,
        title: 'fix: auth bug',
        html_url: 'https://github.com/o/r/pull/7',
        head: { sha: 'sha789', ref: 'fix-auth' },
        user: { login: 'dev' },
        body: 'Resolves #3',
        draft: true,
      },
    ],
    checkRuns: [{ name: 'build', conclusion: 'failure', details_url: 'https://ci.example.com/1' }],
  });

  const result = await reader.listRevisions();

  expect(result[0]).toMatchObject({
    id: '7',
    title: 'fix: auth bug',
    url: 'https://github.com/o/r/pull/7',
    headSHA: 'sha789',
    headRef: 'fix-auth',
    author: 'dev',
    body: 'Resolves #3',
    isDraft: true,
    workItemID: '3',
    reviewID: null,
  });
  expect(result[0]?.pipeline?.status).toBe('failure');
});

// --- Pipeline caching ---

test('it skips CI fetch when head SHA is unchanged and cached status is success', async () => {
  const client = createMockGitHubClient();

  vi.mocked(client.pulls.list).mockResolvedValue({
    data: [buildPRData({ number: 1, head: { sha: 'same-sha', ref: 'branch' } })],
  });
  vi.mocked(client.pulls.listReviews).mockResolvedValue({ data: [] });
  vi.mocked(client.repos.getCombinedStatusForRef).mockResolvedValue({
    data: buildCombinedStatus('success', 1),
  });
  vi.mocked(client.checks.listForRef).mockResolvedValue({
    data: { total_count: 1, check_runs: [buildCheckRun({ conclusion: 'success' })] },
  });

  const reader = createRevisionReader({ client, config: buildConfig() });

  await reader.listRevisions();
  expect(client.repos.getCombinedStatusForRef).toHaveBeenCalledTimes(1);

  await reader.listRevisions();
  expect(client.repos.getCombinedStatusForRef).toHaveBeenCalledTimes(1);
});

test('it re-fetches CI status when head SHA changes', async () => {
  const client = createMockGitHubClient();

  let callCount = 0;
  vi.mocked(client.pulls.list).mockImplementation(async () => {
    callCount += 1;
    const sha = callCount === 1 ? 'sha-v1' : 'sha-v2';
    return { data: [buildPRData({ number: 1, head: { sha, ref: 'branch' } })] };
  });
  vi.mocked(client.pulls.listReviews).mockResolvedValue({ data: [] });
  vi.mocked(client.repos.getCombinedStatusForRef).mockResolvedValue({
    data: buildCombinedStatus('success', 1),
  });
  vi.mocked(client.checks.listForRef).mockResolvedValue({
    data: { total_count: 1, check_runs: [buildCheckRun({ conclusion: 'success' })] },
  });

  const reader = createRevisionReader({ client, config: buildConfig() });

  await reader.listRevisions();
  expect(client.repos.getCombinedStatusForRef).toHaveBeenCalledTimes(1);

  await reader.listRevisions();
  expect(client.repos.getCombinedStatusForRef).toHaveBeenCalledTimes(2);
});

// --- getRevision ---

test('it returns a single revision by id', async () => {
  const { reader } = setupTest({
    getPR: { number: 42, title: 'Single PR' },
  });

  const result = await reader.getRevision('42');

  expect(result).not.toBeNull();
  expect(result?.id).toBe('42');
  expect(result?.title).toBe('Single PR');
});

test('it returns null when revision is not found', async () => {
  const { reader, client } = setupTest();
  vi.mocked(client.pulls.get).mockRejectedValue({ status: 404 });

  const result = await reader.getRevision('999');

  expect(result).toBeNull();
});

test('it propagates non-404 errors from get revision', async () => {
  const { reader, client } = setupTest();
  vi.mocked(client.pulls.get).mockRejectedValue({ status: 422 });

  await expect(reader.getRevision('1')).rejects.toMatchObject({ status: 422 });
});

// --- getRevisionFiles ---

test('it returns revision files with path, status, and patch', async () => {
  const { reader } = setupTest({
    files: [
      { filename: 'src/index.ts', status: 'modified', patch: '@@ -1,3 +1,4 @@' },
      { filename: 'src/new.ts', status: 'added', patch: '@@ -0,0 +1,10 @@' },
    ],
  });

  const result = await reader.getRevisionFiles('1');

  expect(result).toStrictEqual([
    { path: 'src/index.ts', status: 'modified', patch: '@@ -1,3 +1,4 @@' },
    { path: 'src/new.ts', status: 'added', patch: '@@ -0,0 +1,10 @@' },
  ]);
});

test('it returns null patch for files without a patch field', async () => {
  const { reader } = setupTest({
    files: [{ filename: 'image.png', status: 'added' }],
  });

  const result = await reader.getRevisionFiles('1');

  expect(result[0]?.patch).toBeNull();
});

test('it throws on 404 for revision files', async () => {
  const { reader, client } = setupTest();
  vi.mocked(client.pulls.listFiles).mockRejectedValue({ status: 404 });

  await expect(reader.getRevisionFiles('999')).rejects.toMatchObject({ status: 404 });
});

test('it maps file statuses to the domain file status type', async () => {
  const { reader } = setupTest({
    files: [
      { filename: 'a.ts', status: 'removed' },
      { filename: 'b.ts', status: 'renamed' },
      { filename: 'c.ts', status: 'copied' },
    ],
  });

  const result = await reader.getRevisionFiles('1');

  expect(result[0]?.status).toBe('removed');
  expect(result[1]?.status).toBe('renamed');
  expect(result[2]?.status).toBe('copied');
});

// --- getReviewHistory ---

test('it returns reviews and inline comments for a revision', async () => {
  const { reader, client } = setupTest();

  vi.mocked(client.pulls.listReviews).mockResolvedValue({
    data: [
      {
        id: 1,
        user: { login: 'alice' },
        state: 'APPROVED',
        body: 'LGTM',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
  });
  vi.mocked(client.pulls.listReviewComments).mockResolvedValue({
    data: [{ id: 10, user: { login: 'bob' }, body: 'Fix this', path: 'src/foo.ts', line: 42 }],
  });

  const result = await reader.getReviewHistory('5');

  expect(result).toStrictEqual({
    reviews: [{ author: 'alice', state: 'APPROVED', body: 'LGTM' }],
    inlineComments: [{ path: 'src/foo.ts', line: 42, author: 'bob', body: 'Fix this' }],
  });
});

test('it returns empty history when no reviews or comments exist', async () => {
  const { reader } = setupTest();

  const result = await reader.getReviewHistory('1');

  expect(result).toStrictEqual({ reviews: [], inlineComments: [] });
});

test('it defaults author to empty string when user is null', async () => {
  const { reader, client } = setupTest();

  vi.mocked(client.pulls.listReviews).mockResolvedValue({
    data: [
      { id: 1, user: null, state: 'COMMENTED', body: null, submitted_at: '2026-01-01T00:00:00Z' },
    ],
  });
  vi.mocked(client.pulls.listReviewComments).mockResolvedValue({
    data: [{ id: 10, user: null, body: null, path: 'src/bar.ts', line: null }],
  });

  const result = await reader.getReviewHistory('1');

  expect(result.reviews[0]?.author).toBe('');
  expect(result.inlineComments[0]?.author).toBe('');
});

test('it excludes reviews with pending state from review history', async () => {
  const { reader, client } = setupTest();

  vi.mocked(client.pulls.listReviews).mockResolvedValue({
    data: [
      {
        id: 1,
        user: { login: 'alice' },
        state: 'APPROVED',
        body: 'LGTM',
        submitted_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        user: { login: 'bob' },
        state: 'PENDING',
        body: 'Draft review',
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ],
  });
  vi.mocked(client.pulls.listReviewComments).mockResolvedValue({ data: [] });

  const result = await reader.getReviewHistory('1');

  expect(result.reviews).toStrictEqual([{ author: 'alice', state: 'APPROVED', body: 'LGTM' }]);
});

test('it defaults body to empty string when body is null', async () => {
  const { reader, client } = setupTest();

  vi.mocked(client.pulls.listReviews).mockResolvedValue({
    data: [
      {
        id: 1,
        user: { login: 'dev' },
        state: 'APPROVED',
        body: null,
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ],
  });
  vi.mocked(client.pulls.listReviewComments).mockResolvedValue({
    data: [{ id: 10, user: { login: 'dev' }, body: null, path: 'a.ts', line: 1 }],
  });

  const result = await reader.getReviewHistory('1');

  expect(result.reviews[0]?.body).toBe('');
  expect(result.inlineComments[0]?.body).toBe('');
});
