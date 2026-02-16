import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../../test-utils/create-mock-github-client.ts';
import type { AgentReview } from '../../state-store/domain-type-stubs.ts';
import type { RevisionWriterConfig } from './create-revision-writer.ts';
import { createRevisionWriter } from './create-revision-writer.ts';

class OctokitNotFoundError extends Error {
  status: number;

  constructor() {
    super('Not Found');
    this.status = 404;
  }
}

function buildConfig(): RevisionWriterConfig {
  return { owner: 'test-owner', repo: 'test-repo', defaultBranch: 'main' };
}

function setupTest(): {
  writer: ReturnType<typeof createRevisionWriter>;
  client: ReturnType<typeof createMockGitHubClient>;
} {
  const client = createMockGitHubClient();
  const writer = createRevisionWriter({ client, config: buildConfig() });
  return { writer, client };
}

const SIMPLE_PATCH: string = [
  'diff --git a/src/hello.ts b/src/hello.ts',
  'new file mode 100644',
  'index 0000000..1234567',
  '--- /dev/null',
  '+++ b/src/hello.ts',
  '@@ -0,0 +1,3 @@',
  '+export function hello(): string {',
  "+  return 'hello';",
  '+}',
].join('\n');

function setupCreateFromPatchMocks(client: ReturnType<typeof createMockGitHubClient>): void {
  vi.mocked(client.git.getRef).mockImplementation(async (params) => {
    if (params.ref === 'heads/main') {
      return { data: { object: { sha: 'main-sha' } } };
    }
    throw new OctokitNotFoundError();
  });

  vi.mocked(client.git.getCommit).mockResolvedValue({
    data: { sha: 'main-sha', tree: { sha: 'base-tree-sha' } },
  });

  vi.mocked(client.git.createBlob).mockResolvedValue({
    data: { sha: 'blob-sha' },
  });

  vi.mocked(client.git.createTree).mockResolvedValue({
    data: { sha: 'new-tree-sha' },
  });

  vi.mocked(client.git.createCommit).mockResolvedValue({
    data: { sha: 'new-commit-sha' },
  });

  vi.mocked(client.git.createRef).mockResolvedValue({ data: {} });

  vi.mocked(client.pulls.list).mockResolvedValue({ data: [] });

  vi.mocked(client.issues.get).mockResolvedValue({
    data: { number: 1, title: 'Work item title', body: null, labels: [], created_at: '' },
  });

  vi.mocked(client.pulls.create).mockResolvedValue({
    data: {
      number: 5,
      title: 'Work item title',
      html_url: 'https://github.com/test-owner/test-repo/pull/5',
      head: { sha: 'new-commit-sha', ref: 'decree/impl-42' },
      user: { login: 'app-bot[bot]' },
      body: 'Closes #42',
      draft: false,
    },
  });
}

// --- createFromPatch ---

test('it creates a new branch and opens a pr when no pr exists for the work item', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  const result = await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.createRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: 'refs/heads/decree/impl-42',
      sha: 'new-commit-sha',
    }),
  );

  expect(client.pulls.create).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Work item title',
      body: 'Closes #42',
      head: 'decree/impl-42',
      base: 'main',
    }),
  );

  expect(result.id).toBe('5');
  expect(result.workItemID).toBe('42');
});

test('it updates the existing branch when a pr already exists for the same branch', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  // Override: branch exists
  vi.mocked(client.git.getRef).mockImplementation(async (params) => {
    if (params.ref === 'heads/main') {
      return { data: { object: { sha: 'main-sha' } } };
    }
    if (params.ref === 'heads/decree/impl-42') {
      return { data: { object: { sha: 'branch-tip-sha' } } };
    }
    throw new OctokitNotFoundError();
  });

  // Existing PR for the branch
  vi.mocked(client.pulls.list).mockResolvedValue({
    data: [
      {
        number: 3,
        title: 'Existing PR',
        html_url: 'https://github.com/test-owner/test-repo/pull/3',
        head: { sha: 'old-sha', ref: 'decree/impl-42' },
        user: { login: 'app-bot[bot]' },
        body: 'Closes #42',
        draft: false,
      },
    ],
  });

  const result = await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.updateRef).toHaveBeenCalledWith(
    expect.objectContaining({
      ref: 'heads/decree/impl-42',
      sha: 'new-commit-sha',
      force: true,
    }),
  );

  // No new PR should be created
  expect(client.pulls.create).not.toHaveBeenCalled();

  expect(result.id).toBe('3');
  expect(result.headSHA).toBe('new-commit-sha');
});

test('it returns a revision with all fields populated from create-from-patch', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  const result = await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(result).toMatchObject({
    id: '5',
    title: 'Work item title',
    url: 'https://github.com/test-owner/test-repo/pull/5',
    headSHA: 'new-commit-sha',
    headRef: 'decree/impl-42',
    author: 'app-bot[bot]',
    body: 'Closes #42',
    isDraft: false,
    workItemID: '42',
    pipeline: null,
    reviewID: null,
  });
});

test('it applies the patch via git data api without local git binary', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.getRef).toHaveBeenCalled();
  expect(client.git.getCommit).toHaveBeenCalled();
  expect(client.git.createBlob).toHaveBeenCalled();
  expect(client.git.createTree).toHaveBeenCalled();
  expect(client.git.createCommit).toHaveBeenCalled();
});

test('it uses the correct commit message format', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.createCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'decree: apply patch for #42',
    }),
  );
});

test('it uses the branch tip as parent when the branch already exists', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  vi.mocked(client.git.getRef).mockImplementation(async (params) => {
    if (params.ref === 'heads/main') {
      return { data: { object: { sha: 'main-sha' } } };
    }
    if (params.ref === 'heads/decree/impl-42') {
      return { data: { object: { sha: 'branch-tip-sha' } } };
    }
    throw new OctokitNotFoundError();
  });

  vi.mocked(client.pulls.list).mockResolvedValue({ data: [] });

  await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.createCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      parents: ['branch-tip-sha'],
    }),
  );
});

test('it uses the default branch head as parent when the branch does not exist', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  await writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  expect(client.git.createCommit).toHaveBeenCalledWith(
    expect.objectContaining({
      parents: ['main-sha'],
    }),
  );
});

test('it handles file deletions in the patch', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  const deletePatch = [
    'diff --git a/src/old.ts b/src/old.ts',
    'deleted file mode 100644',
    'index 1234567..0000000',
    '--- a/src/old.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-export function old(): string {',
    "-  return 'old';",
    '-}',
  ].join('\n');

  await writer.createFromPatch('42', deletePatch, 'decree/impl-42');

  expect(client.git.createTree).toHaveBeenCalledWith(
    expect.objectContaining({
      tree: expect.arrayContaining([
        expect.objectContaining({
          path: 'src/old.ts',
          sha: null,
        }),
      ]),
    }),
  );
});

// --- postReview ---

test('it maps approve verdict to the approve github review event', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.createReview).mockResolvedValue({
    data: { id: 100 },
  });

  const review: AgentReview = {
    verdict: 'approve',
    summary: 'Looks good',
    comments: [],
  };

  const reviewID = await writer.postReview('5', review);

  expect(client.pulls.createReview).toHaveBeenCalledWith(
    expect.objectContaining({
      pull_number: 5,
      body: 'Looks good',
      event: 'APPROVE',
    }),
  );
  expect(reviewID).toBe('100');
});

test('it maps needs-changes verdict to request changes github review event', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.createReview).mockResolvedValue({
    data: { id: 200 },
  });

  const review: AgentReview = {
    verdict: 'needs-changes',
    summary: 'Needs work',
    comments: [],
  };

  await writer.postReview('5', review);

  expect(client.pulls.createReview).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'REQUEST_CHANGES',
    }),
  );
});

test('it passes path, body, and line for inline review comments', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.createReview).mockResolvedValue({
    data: { id: 300 },
  });

  const review: AgentReview = {
    verdict: 'needs-changes',
    summary: 'Issues found',
    comments: [
      { path: 'src/foo.ts', line: 10, body: 'Fix this' },
      { path: 'src/bar.ts', line: null, body: 'General comment' },
    ],
  };

  await writer.postReview('5', review);

  expect(client.pulls.createReview).toHaveBeenCalledWith(
    expect.objectContaining({
      comments: [
        { path: 'src/foo.ts', line: 10, body: 'Fix this' },
        { path: 'src/bar.ts', body: 'General comment' },
      ],
    }),
  );
});

test('it returns the review id as a string', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.createReview).mockResolvedValue({
    data: { id: 12_345 },
  });

  const review: AgentReview = {
    verdict: 'approve',
    summary: 'Great',
    comments: [],
  };

  const result = await writer.postReview('5', review);

  expect(result).toBe('12345');
});

// --- updateReview ---

test('it dismisses the old review and creates a new one', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.dismissReview).mockResolvedValue({ data: {} });
  vi.mocked(client.pulls.createReview).mockResolvedValue({
    data: { id: 456 },
  });

  const review: AgentReview = {
    verdict: 'approve',
    summary: 'Updated review',
    comments: [],
  };

  await writer.updateReview('5', '123', review);

  expect(client.pulls.dismissReview).toHaveBeenCalledWith(
    expect.objectContaining({
      pull_number: 5,
      review_id: 123,
      message: 'Replacing with updated review',
    }),
  );

  expect(client.pulls.createReview).toHaveBeenCalledWith(
    expect.objectContaining({
      pull_number: 5,
      body: 'Updated review',
      event: 'APPROVE',
    }),
  );
});

// --- postComment ---

test('it posts a standalone issue comment on the pr', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.createComment).mockResolvedValue({ data: {} });

  await writer.postComment('5', 'This is a comment');

  expect(client.issues.createComment).toHaveBeenCalledWith(
    expect.objectContaining({
      issue_number: 5,
      body: 'This is a comment',
    }),
  );
});

// --- updateBody ---

test('it replaces the pr body with the provided string', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.pulls.update).mockResolvedValue({ data: {} });

  await writer.updateBody('5', 'New body');

  expect(client.pulls.update).toHaveBeenCalledWith(
    expect.objectContaining({
      pull_number: 5,
      body: 'New body',
    }),
  );
});

// --- retry wrapping ---

test('it wraps create-from-patch api calls with the retry utility', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  const transientError = { status: 500 };
  vi.mocked(client.git.getRef)
    .mockRejectedValueOnce(transientError)
    .mockImplementation(async (params) => {
      if (params.ref === 'heads/main') {
        return { data: { object: { sha: 'main-sha' } } };
      }
      throw new OctokitNotFoundError();
    });

  vi.useFakeTimers();

  const promise = writer.createFromPatch('42', SIMPLE_PATCH, 'decree/impl-42');

  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(10_000);

  const result = await promise;

  expect(result.id).toBe('5');
  expect(client.git.getRef).toHaveBeenCalledTimes(3);
});

test('it handles a patch with file modification', async () => {
  const { writer, client } = setupTest();
  setupCreateFromPatchMocks(client);

  const modifyPatch = [
    'diff --git a/src/hello.ts b/src/hello.ts',
    'index 1234567..abcdefg 100644',
    '--- a/src/hello.ts',
    '+++ b/src/hello.ts',
    '@@ -1,3 +1,3 @@',
    ' export function hello(): string {',
    "-  return 'hello';",
    "+  return 'world';",
    ' }',
  ].join('\n');

  await writer.createFromPatch('42', modifyPatch, 'decree/impl-42');

  expect(client.git.createBlob).toHaveBeenCalledWith(
    expect.objectContaining({
      content: "export function hello(): string {\n  return 'world';\n}",
      encoding: 'utf-8',
    }),
  );
});
