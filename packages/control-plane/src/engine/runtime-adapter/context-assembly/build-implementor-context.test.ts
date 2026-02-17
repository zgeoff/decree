import { expect, test, vi } from 'vitest';
import { buildRevision } from '../../../test-utils/build-revision.ts';
import { buildWorkItem } from '../../../test-utils/build-work-item.ts';
import type { RevisionFile } from '../../github-provider/types.ts';
import type { EngineState, PipelineResult } from '../../state-store/types.ts';
import type { ImplementorStartParams, ReviewHistory } from '../types.ts';
import { buildImplementorContext } from './build-implementor-context.ts';
import type { BuildImplementorContextDeps } from './types.ts';

function setupTest(overrides?: {
  workItemLinkedRevision?: string | null;
  workItemStatus?: string;
  revisionPipeline?: PipelineResult | null;
  revisionTitle?: string;
  revisionFiles?: RevisionFile[];
  reviewHistory?: ReviewHistory;
  workItemBody?: string;
  getWorkItemBodyError?: Error;
  getRevisionFilesError?: Error;
  getReviewHistoryError?: Error;
}): {
  params: ImplementorStartParams;
  deps: BuildImplementorContextDeps;
} {
  const workItemID = '42';
  const linkedRevision = overrides?.workItemLinkedRevision ?? null;

  const workItem = buildWorkItem({
    id: workItemID,
    title: 'Fix authentication bug',
    status: (overrides?.workItemStatus as 'pending') ?? 'in-progress',
    linkedRevision,
  });

  const state: EngineState = {
    workItems: new Map([[workItemID, workItem]]),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
  };

  if (linkedRevision !== null) {
    const revision = buildRevision({
      id: linkedRevision,
      title: overrides?.revisionTitle ?? 'fix(auth): refresh expired tokens',
      workItemID,
      pipeline: overrides?.revisionPipeline ?? null,
    });
    state.revisions.set(linkedRevision, revision);
  }

  const workItemBody = overrides?.workItemBody ?? 'The login flow fails when the token expires.';

  const getWorkItemBody = overrides?.getWorkItemBodyError
    ? vi.fn<() => Promise<string>>().mockRejectedValue(overrides.getWorkItemBodyError)
    : vi.fn<() => Promise<string>>().mockResolvedValue(workItemBody);

  const revisionFiles = overrides?.revisionFiles ?? [];
  const getRevisionFiles = overrides?.getRevisionFilesError
    ? vi.fn<() => Promise<RevisionFile[]>>().mockRejectedValue(overrides.getRevisionFilesError)
    : vi.fn<() => Promise<RevisionFile[]>>().mockResolvedValue(revisionFiles);

  const reviewHistory = overrides?.reviewHistory ?? { reviews: [], inlineComments: [] };
  const getReviewHistory = overrides?.getReviewHistoryError
    ? vi.fn<() => Promise<ReviewHistory>>().mockRejectedValue(overrides.getReviewHistoryError)
    : vi.fn<() => Promise<ReviewHistory>>().mockResolvedValue(reviewHistory);

  const deps: BuildImplementorContextDeps = {
    workItemReader: {
      listWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      getWorkItemBody,
    },
    revisionReader: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      getRevisionFiles,
    },
    getState: () => state,
    getReviewHistory,
  };

  const params: ImplementorStartParams = {
    role: 'implementor',
    workItemID,
    branchName: 'issue-42-fix-auth',
  };

  return { params, deps };
}

// --- No linked revision (work item only) ---

test('it includes the work item title and id when no linked revision exists', async () => {
  const { params, deps } = setupTest();

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('## Work Item #42 — Fix authentication bug');
});

test('it includes the work item body when no linked revision exists', async () => {
  const { params, deps } = setupTest();

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('The login flow fails when the token expires.');
});

test('it includes the work item status when no linked revision exists', async () => {
  const { params, deps } = setupTest();

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('### Status');
  expect(result).toContain('in-progress');
});

test('it omits revision, reviews, and CI sections when no linked revision exists', async () => {
  const { params, deps } = setupTest();

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('## Revision');
  expect(result).not.toContain('### Changed Files');
  expect(result).not.toContain('### CI Status');
  expect(result).not.toContain('### Prior Reviews');
  expect(result).not.toContain('### Prior Inline Comments');
});

// --- Linked revision ---

test('it includes revision files when a linked revision exists', async () => {
  const revisionFiles: RevisionFile[] = [
    {
      path: 'src/auth/login.ts',
      status: 'modified',
      patch: '@@ -10,3 +10,5 @@\n-const token = getToken();\n+const token = refreshToken();',
    },
  ];

  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionFiles,
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('## Revision #99 — fix(auth): refresh expired tokens');
  expect(result).toContain('### Changed Files');
  expect(result).toContain('#### src/auth/login.ts (modified)');
  expect(result).toContain(
    '@@ -10,3 +10,5 @@\n-const token = getToken();\n+const token = refreshToken();',
  );
});

test('it includes path and status but no code block for binary files', async () => {
  const revisionFiles: RevisionFile[] = [
    {
      path: 'assets/logo.png',
      status: 'added',
      patch: null,
    },
  ];

  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionFiles,
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('#### assets/logo.png (added)');
  const fileEntryIndex = result.indexOf('#### assets/logo.png (added)');
  const nextSectionIndex = result.indexOf('##', fileEntryIndex + 1);
  const afterEntry =
    nextSectionIndex === -1
      ? result.slice(fileEntryIndex)
      : result.slice(fileEntryIndex, nextSectionIndex);
  expect(afterEntry).not.toContain('```');
});

test('it handles a mix of files with and without patches', async () => {
  const revisionFiles: RevisionFile[] = [
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

  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionFiles,
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('#### src/code.ts (modified)');
  expect(result).toContain('@@ -1,1 +1,2 @@\n+new line');
  expect(result).toContain('#### assets/image.png (added)');
  expect(result).toContain('#### src/other.ts (removed)');
  expect(result).toContain('@@ -1,3 +0,0 @@\n-removed content');
});

// --- CI Status ---

test('it includes CI status section when pipeline status is failure', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionPipeline: {
      status: 'failure',
      reason: 'lint check failed',
      url: 'https://github.com/owner/repo/runs/123',
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('### CI Status: FAILURE');
  expect(result).toContain('lint check failed: https://github.com/owner/repo/runs/123');
});

test('it omits CI status section when pipeline status is success', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionPipeline: {
      status: 'success',
      reason: null,
      url: 'https://github.com/owner/repo/runs/123',
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### CI Status');
});

test('it omits CI status section when pipeline status is pending', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionPipeline: {
      status: 'pending',
      reason: null,
      url: null,
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### CI Status');
});

test('it omits CI status section when pipeline is null', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionPipeline: null,
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### CI Status');
});

// --- Prior Reviews ---

test('it includes prior reviews when review history has reviews', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: {
      reviews: [
        {
          author: 'reviewer1',
          state: 'CHANGES_REQUESTED',
          body: 'Please add error handling for the refresh call.',
        },
      ],
      inlineComments: [],
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('### Prior Reviews');
  expect(result).toContain('#### Review by reviewer1 — CHANGES_REQUESTED');
  expect(result).toContain('Please add error handling for the refresh call.');
});

test('it omits prior reviews section when review history has no reviews', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### Prior Reviews');
});

// --- Prior Inline Comments ---

test('it includes prior inline comments when review history has comments', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: {
      reviews: [],
      inlineComments: [
        {
          path: 'src/auth/login.ts',
          line: 12,
          author: 'reviewer1',
          body: 'This should handle the case where refreshToken throws.',
        },
      ],
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('### Prior Inline Comments');
  expect(result).toContain('#### src/auth/login.ts:12 — reviewer1');
  expect(result).toContain('This should handle the case where refreshToken throws.');
});

test('it omits prior inline comments section when review history has no comments', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### Prior Inline Comments');
});

test('it handles inline comments with null line numbers', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: {
      reviews: [],
      inlineComments: [
        {
          path: 'src/old.ts',
          line: null,
          author: 'alice',
          body: 'Outdated comment',
        },
      ],
    },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).toContain('#### src/old.ts:outdated — alice');
  expect(result).toContain('Outdated comment');
});

// --- Both reviews and inline comments omitted when empty ---

test('it omits both review sections when review history is entirely empty', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    reviewHistory: { reviews: [], inlineComments: [] },
  });

  const result = await buildImplementorContext(params, deps);

  expect(result).not.toContain('### Prior Reviews');
  expect(result).not.toContain('### Prior Inline Comments');
});

// --- Error handling ---

test('it throws when the work item body fetch fails', async () => {
  const { params, deps } = setupTest({
    getWorkItemBodyError: new Error('Network error'),
  });

  await expect(buildImplementorContext(params, deps)).rejects.toThrow('Network error');
});

test('it throws when the revision files fetch fails', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    getRevisionFilesError: new Error('API error'),
  });

  await expect(buildImplementorContext(params, deps)).rejects.toThrow('API error');
});

test('it throws when the review history fetch fails', async () => {
  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    getReviewHistoryError: new Error('Review fetch failed'),
  });

  await expect(buildImplementorContext(params, deps)).rejects.toThrow('Review fetch failed');
});

test('it throws when the work item is not found in state', async () => {
  const deps: BuildImplementorContextDeps = {
    workItemReader: {
      listWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      getWorkItemBody: vi.fn(),
    },
    revisionReader: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      getRevisionFiles: vi.fn(),
    },
    getState: () => ({
      workItems: new Map(),
      revisions: new Map(),
      specs: new Map(),
      agentRuns: new Map(),
      errors: [],
      lastPlannedSHAs: new Map(),
    }),
    getReviewHistory: vi.fn(),
  };

  const params: ImplementorStartParams = {
    role: 'implementor',
    workItemID: 'nonexistent',
    branchName: 'branch-1',
  };

  await expect(buildImplementorContext(params, deps)).rejects.toThrow(
    'Work item nonexistent not found in state',
  );
});

test('it throws when the linked revision is not found in state', async () => {
  const workItem = buildWorkItem({
    id: '42',
    linkedRevision: 'missing-revision',
  });

  const deps: BuildImplementorContextDeps = {
    workItemReader: {
      listWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      getWorkItemBody: vi.fn<() => Promise<string>>().mockResolvedValue('body'),
    },
    revisionReader: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      getRevisionFiles: vi.fn(),
    },
    getState: () => ({
      workItems: new Map([['42', workItem]]),
      revisions: new Map(),
      specs: new Map(),
      agentRuns: new Map(),
      errors: [],
      lastPlannedSHAs: new Map(),
    }),
    getReviewHistory: vi.fn(),
  };

  const params: ImplementorStartParams = {
    role: 'implementor',
    workItemID: '42',
    branchName: 'branch-1',
  };

  await expect(buildImplementorContext(params, deps)).rejects.toThrow(
    'Revision missing-revision not found in state',
  );
});

// --- Section ordering ---

test('it produces the correct section order for a complete prompt with linked revision', async () => {
  const revisionFiles: RevisionFile[] = [
    {
      path: 'src/auth/login.ts',
      status: 'modified',
      patch: '@@ -10,3 +10,5 @@\n+fix',
    },
  ];

  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
    revisionPipeline: {
      status: 'failure',
      reason: 'build failed',
      url: 'https://example.com/runs/1',
    },
    revisionFiles,
    reviewHistory: {
      reviews: [{ author: 'alice', state: 'CHANGES_REQUESTED', body: 'Fix the bug.' }],
      inlineComments: [
        { path: 'src/auth/login.ts', line: 10, author: 'alice', body: 'Here is the issue.' },
      ],
    },
  });

  const result = await buildImplementorContext(params, deps);

  const workItemIndex = result.indexOf('## Work Item #42');
  const statusIndex = result.indexOf('### Status');
  const revisionIndex = result.indexOf('## Revision #99');
  const changedFilesIndex = result.indexOf('### Changed Files');
  const ciStatusIndex = result.indexOf('### CI Status: FAILURE');
  const priorReviewsIndex = result.indexOf('### Prior Reviews');
  const priorCommentsIndex = result.indexOf('### Prior Inline Comments');

  expect(workItemIndex).toBeLessThan(statusIndex);
  expect(statusIndex).toBeLessThan(revisionIndex);
  expect(revisionIndex).toBeLessThan(changedFilesIndex);
  expect(changedFilesIndex).toBeLessThan(ciStatusIndex);
  expect(ciStatusIndex).toBeLessThan(priorReviewsIndex);
  expect(priorReviewsIndex).toBeLessThan(priorCommentsIndex);
});

test('it fetches revision files and review history in parallel', async () => {
  const callOrder: string[] = [];

  const revisionFiles: RevisionFile[] = [
    { path: 'src/code.ts', status: 'modified', patch: '+fix' },
  ];

  const { params, deps } = setupTest({
    workItemLinkedRevision: '99',
  });

  // Replace mocks with tracking versions
  deps.revisionReader.getRevisionFiles = vi.fn(async () => {
    callOrder.push('getRevisionFiles-start');
    callOrder.push('getRevisionFiles-end');
    return revisionFiles;
  });

  deps.getReviewHistory = vi.fn(async () => {
    callOrder.push('getReviewHistory-start');
    callOrder.push('getReviewHistory-end');
    return { reviews: [], inlineComments: [] };
  });

  await buildImplementorContext(params, deps);

  // Both should have been called
  expect(deps.revisionReader.getRevisionFiles).toHaveBeenCalledWith('99');
  expect(deps.getReviewHistory).toHaveBeenCalledWith('99');
});

test('it does not fetch revision files or review history when no linked revision exists', async () => {
  const { params, deps } = setupTest();

  await buildImplementorContext(params, deps);

  expect(deps.revisionReader.getRevisionFiles).not.toHaveBeenCalled();
  expect(deps.getReviewHistory).not.toHaveBeenCalled();
});
