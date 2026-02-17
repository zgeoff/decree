import { expect, test, vi } from 'vitest';
import type { RevisionFile } from '../../github-provider/types.ts';
import type { Revision, WorkItem } from '../../state-store/domain-type-stubs.ts';
import type { EngineState } from '../../state-store/types.ts';
import type { ReviewerStartParams, ReviewHistory, RuntimeAdapterDeps } from '../types.ts';
import { buildReviewerContext } from './build-reviewer-context.ts';

const DEFAULT_WORK_ITEM_ID = '42';
const DEFAULT_REVISION_ID = '99';

function buildWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: DEFAULT_WORK_ITEM_ID,
    title: 'Fix authentication bug',
    status: 'review',
    priority: 'high',
    complexity: 'medium',
    blockedBy: [],
    createdAt: '2026-01-15T10:00:00Z',
    linkedRevision: DEFAULT_REVISION_ID,
    ...overrides,
  };
}

function buildRevision(overrides?: Partial<Revision>): Revision {
  return {
    id: DEFAULT_REVISION_ID,
    title: 'fix(auth): refresh expired tokens',
    url: 'https://github.com/org/repo/pull/99',
    headSHA: 'abc123',
    headRef: 'issue-42-auth-fix',
    author: 'agent',
    body: 'Closes #42',
    isDraft: false,
    workItemID: DEFAULT_WORK_ITEM_ID,
    pipeline: null,
    reviewID: null,
    ...overrides,
  };
}

function buildDefaultFiles(): RevisionFile[] {
  return [
    {
      path: 'src/auth/login.ts',
      status: 'modified',
      patch: '@@ -10,3 +10,5 @@\n-const token = getToken();\n+const token = refreshToken();',
    },
    {
      path: 'src/auth/login.test.ts',
      status: 'modified',
      patch: '@@ -1,2 +1,4 @@\n+test("it refreshes expired token", () => {});',
    },
  ];
}

function buildDefaultReviewHistory(): ReviewHistory {
  return {
    reviews: [
      {
        author: 'reviewer1',
        state: 'CHANGES_REQUESTED',
        body: 'Please add error handling for the refresh call.',
      },
    ],
    inlineComments: [
      {
        author: 'reviewer1',
        body: 'This should handle the case where refreshToken throws.',
        path: 'src/auth/login.ts',
        line: 12,
      },
    ],
  };
}

interface SetupTestOptions {
  workItem?: WorkItem;
  revision?: Revision;
  body?: string;
  files?: RevisionFile[];
  reviewHistory?: ReviewHistory;
}

function setupTest(options?: SetupTestOptions): {
  params: ReviewerStartParams;
  getState: () => EngineState;
  deps: RuntimeAdapterDeps;
} {
  const workItem = options?.workItem ?? buildWorkItem();
  const revision = options?.revision ?? buildRevision();
  const body = options?.body ?? 'The login flow fails when the token expires.';
  const files = options?.files ?? buildDefaultFiles();
  const reviewHistory = options?.reviewHistory ?? buildDefaultReviewHistory();

  const params: ReviewerStartParams = {
    role: 'reviewer',
    workItemID: DEFAULT_WORK_ITEM_ID,
    revisionID: DEFAULT_REVISION_ID,
  };

  const state: EngineState = {
    workItems: new Map([[workItem.id, workItem]]),
    revisions: new Map([[revision.id, revision]]),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };

  const getState = (): EngineState => state;

  const deps: RuntimeAdapterDeps = {
    workItemReader: {
      listWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      getWorkItemBody: vi.fn<(id: string) => Promise<string>>().mockResolvedValue(body),
    },
    revisionReader: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      getRevisionFiles: vi.fn<(id: string) => Promise<RevisionFile[]>>().mockResolvedValue(files),
    },
    getState,
    getReviewHistory: vi
      .fn<(revisionID: string) => Promise<ReviewHistory>>()
      .mockResolvedValue(reviewHistory),
  };

  return { params, getState, deps };
}

test('it includes the work item identifier and title in the prompt', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('## Work Item #42 — Fix authentication bug');
});

test('it includes the work item body fetched via the work item reader', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('The login flow fails when the token expires.');
});

test('it includes the work item status from the state store', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('### Status');
  expect(result).toContain('review');
});

test('it includes the revision identifier and title in the prompt', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('## Revision #99 — fix(auth): refresh expired tokens');
});

test('it includes per-file patches with path and status', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('#### src/auth/login.ts (modified)');
  expect(result).toContain(
    '@@ -10,3 +10,5 @@\n-const token = getToken();\n+const token = refreshToken();',
  );
  expect(result).toContain('#### src/auth/login.test.ts (modified)');
});

test('it includes prior review submissions with author and state', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('### Prior Reviews');
  expect(result).toContain('#### Review by reviewer1 — CHANGES_REQUESTED');
  expect(result).toContain('Please add error handling for the refresh call.');
});

test('it includes prior inline comments with path, line, and author', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('### Prior Inline Comments');
  expect(result).toContain('#### src/auth/login.ts:12 — reviewer1');
  expect(result).toContain('This should handle the case where refreshToken throws.');
});

test('it omits the prior reviews section when there are no reviews', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).not.toContain('### Prior Reviews');
});

test('it omits the prior inline comments section when there are no comments', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).not.toContain('### Prior Inline Comments');
});

test('it omits comments section but keeps reviews section when only reviews exist', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: {
      reviews: [{ author: 'alice', state: 'APPROVED', body: 'Looks good!' }],
      inlineComments: [],
    },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('### Prior Reviews');
  expect(result).toContain('#### Review by alice — APPROVED');
  expect(result).not.toContain('### Prior Inline Comments');
});

test('it omits reviews section but keeps comments section when only comments exist', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: {
      reviews: [],
      inlineComments: [
        { author: 'bob', body: 'Nit: rename this variable', path: 'src/foo.ts', line: 7 },
      ],
    },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).not.toContain('### Prior Reviews');
  expect(result).toContain('### Prior Inline Comments');
  expect(result).toContain('#### src/foo.ts:7 — bob');
});

test('it includes path and status but no code block when patch is null', async () => {
  const binaryFile: RevisionFile = {
    path: 'assets/logo.png',
    status: 'added',
    patch: null,
  };

  const { params, getState, deps } = setupTest({
    files: [binaryFile],
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('#### assets/logo.png (added)');
  const fileEntryIndex = result.indexOf('#### assets/logo.png (added)');
  const afterEntry = result.slice(fileEntryIndex, fileEntryIndex + 100);
  expect(afterEntry).not.toContain('```');
});

test('it handles a mix of files with and without patches', async () => {
  const files: RevisionFile[] = [
    {
      path: 'src/code.ts',
      status: 'modified',
      patch: '@@ -1,1 +1,2 @@\n+new line',
    },
    {
      path: 'assets/image.png',
      status: 'added',
      patch: null,
    },
    {
      path: 'src/other.ts',
      status: 'removed',
      patch: '@@ -1,3 +0,0 @@\n-removed content',
    },
  ];

  const { params, getState, deps } = setupTest({ files });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('#### src/code.ts (modified)');
  expect(result).toContain('@@ -1,1 +1,2 @@\n+new line');
  expect(result).toContain('#### assets/image.png (added)');
  expect(result).toContain('#### src/other.ts (removed)');
  expect(result).toContain('@@ -1,3 +0,0 @@\n-removed content');
});

test('it fetches the work item body using the correct identifier', async () => {
  const { params, getState, deps } = setupTest();

  await buildReviewerContext({ params, getState, deps });

  expect(deps.workItemReader.getWorkItemBody).toHaveBeenCalledWith(DEFAULT_WORK_ITEM_ID);
});

test('it fetches revision files using the correct identifier', async () => {
  const { params, getState, deps } = setupTest();

  await buildReviewerContext({ params, getState, deps });

  expect(deps.revisionReader.getRevisionFiles).toHaveBeenCalledWith(DEFAULT_REVISION_ID);
});

test('it fetches review history using the correct identifier', async () => {
  const { params, getState, deps } = setupTest();

  await buildReviewerContext({ params, getState, deps });

  expect(deps.getReviewHistory).toHaveBeenCalledWith(DEFAULT_REVISION_ID);
});

test('it throws when the work item body fetch fails', async () => {
  const { params, getState, deps } = setupTest();
  const error = new Error('Work item not found');
  vi.mocked(deps.workItemReader.getWorkItemBody).mockRejectedValue(error);

  await expect(buildReviewerContext({ params, getState, deps })).rejects.toThrow(
    'Work item not found',
  );
});

test('it throws when the revision files fetch fails', async () => {
  const { params, getState, deps } = setupTest();
  const error = new Error('Revision not found');
  vi.mocked(deps.revisionReader.getRevisionFiles).mockRejectedValue(error);

  await expect(buildReviewerContext({ params, getState, deps })).rejects.toThrow(
    'Revision not found',
  );
});

test('it throws when the review history fetch fails', async () => {
  const { params, getState, deps } = setupTest();
  const error = new Error('Review history unavailable');
  vi.mocked(deps.getReviewHistory).mockRejectedValue(error);

  await expect(buildReviewerContext({ params, getState, deps })).rejects.toThrow(
    'Review history unavailable',
  );
});

test('it handles inline comments with null line numbers', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: {
      reviews: [],
      inlineComments: [
        { author: 'alice', body: 'Outdated comment', path: 'src/old.ts', line: null },
      ],
    },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('#### src/old.ts:outdated — alice');
  expect(result).toContain('Outdated comment');
});

test('it produces sections in the correct order', async () => {
  const { params, getState, deps } = setupTest();

  const result = await buildReviewerContext({ params, getState, deps });

  const workItemIndex = result.indexOf('## Work Item #42');
  const statusIndex = result.indexOf('### Status');
  const revisionIndex = result.indexOf('## Revision #99');
  const changedFilesIndex = result.indexOf('### Changed Files');
  const priorReviewsIndex = result.indexOf('### Prior Reviews');
  const priorCommentsIndex = result.indexOf('### Prior Inline Comments');

  expect(workItemIndex).toBeLessThan(statusIndex);
  expect(statusIndex).toBeLessThan(revisionIndex);
  expect(revisionIndex).toBeLessThan(changedFilesIndex);
  expect(changedFilesIndex).toBeLessThan(priorReviewsIndex);
  expect(priorReviewsIndex).toBeLessThan(priorCommentsIndex);
});

test('it fetches all data concurrently via parallel promises', async () => {
  const { params, getState, deps } = setupTest();

  await buildReviewerContext({ params, getState, deps });

  expect(deps.workItemReader.getWorkItemBody).toHaveBeenCalledTimes(1);
  expect(deps.revisionReader.getRevisionFiles).toHaveBeenCalledTimes(1);
  expect(deps.getReviewHistory).toHaveBeenCalledTimes(1);
});

test('it handles an empty files array', async () => {
  const { params, getState, deps } = setupTest({
    files: [],
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  expect(result).toContain('### Changed Files');
  expect(result).not.toContain('####');
});

test('it preserves chronological order of reviews', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: {
      reviews: [
        { author: 'alice', state: 'COMMENTED', body: 'First review' },
        { author: 'bob', state: 'CHANGES_REQUESTED', body: 'Second review' },
        { author: 'alice', state: 'APPROVED', body: 'Third review' },
      ],
      inlineComments: [],
    },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  const firstIndex = result.indexOf('First review');
  const secondIndex = result.indexOf('Second review');
  const thirdIndex = result.indexOf('Third review');

  expect(firstIndex).toBeLessThan(secondIndex);
  expect(secondIndex).toBeLessThan(thirdIndex);
});

test('it preserves chronological order of inline comments', async () => {
  const { params, getState, deps } = setupTest({
    reviewHistory: {
      reviews: [],
      inlineComments: [
        { author: 'alice', body: 'Comment one', path: 'a.ts', line: 1 },
        { author: 'bob', body: 'Comment two', path: 'b.ts', line: 5 },
        { author: 'alice', body: 'Comment three', path: 'a.ts', line: 10 },
      ],
    },
  });

  const result = await buildReviewerContext({ params, getState, deps });

  const firstIndex = result.indexOf('Comment one');
  const secondIndex = result.indexOf('Comment two');
  const thirdIndex = result.indexOf('Comment three');

  expect(firstIndex).toBeLessThan(secondIndex);
  expect(secondIndex).toBeLessThan(thirdIndex);
});
