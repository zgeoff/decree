import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { expect, test, vi } from 'vitest';
import { createGitHubClient } from './create-github-client.ts';
import type { GitCreateTreeParams, GitHubClientConfig, PullsCreateReviewParams } from './types.ts';

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(),
}));

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: vi.fn(),
}));

type MockFn = ReturnType<typeof vi.fn>;

interface MockOctokitShape {
  apps: { getAuthenticated: MockFn };
  issues: {
    get: MockFn;
    listForRepo: MockFn;
    create: MockFn;
    update: MockFn;
    listLabelsOnIssue: MockFn;
    addLabels: MockFn;
    removeLabel: MockFn;
    createComment: MockFn;
  };
  pulls: {
    list: MockFn;
    get: MockFn;
    listFiles: MockFn;
    listReviews: MockFn;
    listReviewComments: MockFn;
    create: MockFn;
    update: MockFn;
    createReview: MockFn;
    dismissReview: MockFn;
  };
  repos: { getCombinedStatusForRef: MockFn; getContent: MockFn };
  checks: { listForRef: MockFn };
  git: {
    getTree: MockFn;
    getRef: MockFn;
    getBlob: MockFn;
    getCommit: MockFn;
    createBlob: MockFn;
    createTree: MockFn;
    createCommit: MockFn;
    createRef: MockFn;
    updateRef: MockFn;
  };
}

const mockedOctokit: ReturnType<typeof vi.mocked<typeof Octokit>> = vi.mocked(Octokit);

function setupTest(): {
  client: ReturnType<typeof createGitHubClient>;
  mockOctokit: MockOctokitShape;
  config: GitHubClientConfig;
} {
  const mockOctokit: MockOctokitShape = {
    apps: {
      getAuthenticated: vi.fn(),
    },
    issues: {
      get: vi.fn(),
      listForRepo: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      listLabelsOnIssue: vi.fn(),
      addLabels: vi.fn(),
      removeLabel: vi.fn(),
      createComment: vi.fn(),
    },
    pulls: {
      list: vi.fn(),
      get: vi.fn(),
      listFiles: vi.fn(),
      listReviews: vi.fn(),
      listReviewComments: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      createReview: vi.fn(),
      dismissReview: vi.fn(),
    },
    repos: {
      getCombinedStatusForRef: vi.fn(),
      getContent: vi.fn(),
    },
    checks: {
      listForRef: vi.fn(),
    },
    git: {
      getTree: vi.fn(),
      getRef: vi.fn(),
      getBlob: vi.fn(),
      getCommit: vi.fn(),
      createBlob: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      createRef: vi.fn(),
      updateRef: vi.fn(),
    },
  };

  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires function expression for `new`
  mockedOctokit.mockImplementation(function () {
    return mockOctokit;
  });

  const config: GitHubClientConfig = {
    appID: 12_345,
    // biome-ignore lint/security/noSecrets: test fixture with fake credential format
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    installationID: 67_890,
  };

  const client = createGitHubClient(config);

  return { client, mockOctokit, config };
}

// ---------------------------------------------------------------------------
// Factory construction
// ---------------------------------------------------------------------------

test('it creates the client with app auth using the provided credentials', () => {
  // biome-ignore lint/complexity/useArrowFunction: constructor mock requires function expression for `new`
  mockedOctokit.mockImplementation(function () {
    return {};
  });

  const config: GitHubClientConfig = {
    appID: 42,
    privateKey: 'test-key',
    installationID: 99,
  };

  createGitHubClient(config);

  expect(Octokit).toHaveBeenCalledWith({
    authStrategy: createAppAuth,
    auth: {
      appId: 42,
      privateKey: 'test-key',
      installationId: 99,
    },
  });
});

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

test('it delegates app authentication and returns the slug', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.apps.getAuthenticated.mockResolvedValue({
    data: { slug: 'my-app', id: 123 },
  });

  const result = await client.apps.getAuthenticated();

  expect(mockOctokit.apps.getAuthenticated).toHaveBeenCalled();
  expect(result.data.slug).toBe('my-app');
});

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

test('it delegates issue retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.get.mockResolvedValue({
    data: {
      number: 42,
      title: 'Test issue',
      body: 'Issue body',
      labels: [{ name: 'bug' }],
      created_at: '2026-01-01T00:00:00Z',
      extra_field: 'ignored',
    },
  });

  const params = { owner: 'test-owner', repo: 'test-repo', issue_number: 42 };
  const result = await client.issues.get(params);

  expect(mockOctokit.issues.get).toHaveBeenCalledWith(params);
  expect(result.data.number).toBe(42);
  expect(result.data.title).toBe('Test issue');
  expect(result.data.body).toBe('Issue body');
});

test('it coerces undefined issue body to null', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.get.mockResolvedValue({
    data: {
      number: 1,
      title: 'No body',
      body: undefined,
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
    },
  });

  const result = await client.issues.get({ owner: 'o', repo: 'r', issue_number: 1 });

  expect(result.data.body).toBeNull();
});

test('it delegates issue listing and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.listForRepo.mockResolvedValue({
    data: [
      {
        number: 1,
        title: 'First',
        body: 'Body 1',
        labels: ['label-a'],
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        number: 2,
        title: 'Second',
        body: null,
        labels: [],
        created_at: '2026-01-02T00:00:00Z',
      },
    ],
  });

  const params = {
    owner: 'o',
    repo: 'r',
    labels: 'task:implement',
    state: 'open' as const,
    per_page: 100,
  };
  const result = await client.issues.listForRepo(params);

  expect(mockOctokit.issues.listForRepo).toHaveBeenCalledWith(params);
  expect(result.data).toHaveLength(2);
  expect(result.data[0]?.number).toBe(1);
  expect(result.data[1]?.body).toBeNull();
});

test('it delegates issue creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.create.mockResolvedValue({
    data: {
      number: 99,
      title: 'New issue',
      body: 'Issue body',
      labels: [{ name: 'bug' }],
      created_at: '2026-01-01T00:00:00Z',
      extra_field: 'ignored',
    },
  });

  const params = { owner: 'o', repo: 'r', title: 'New issue', body: 'Issue body' };
  const result = await client.issues.create(params);

  expect(mockOctokit.issues.create).toHaveBeenCalledWith(params);
  expect(result.data.number).toBe(99);
  expect(result.data.title).toBe('New issue');
});

test('it delegates issue update and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.update.mockResolvedValue({
    data: {
      number: 42,
      title: 'Updated',
      body: 'New body',
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
    },
  });

  const params = { owner: 'o', repo: 'r', issue_number: 42, body: 'New body' };
  const result = await client.issues.update(params);

  expect(mockOctokit.issues.update).toHaveBeenCalledWith(params);
  expect(result.data.number).toBe(42);
  expect(result.data.body).toBe('New body');
});

test('it delegates listing labels on an issue and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.listLabelsOnIssue.mockResolvedValue({
    data: [
      { id: 1, name: 'bug', color: 'ff0000', description: 'Bug label' },
      { id: 2, name: 'feature', color: '00ff00', description: 'Feature label' },
    ],
  });

  const params = { owner: 'o', repo: 'r', issue_number: 42, per_page: 100 };
  const result = await client.issues.listLabelsOnIssue(params);

  expect(mockOctokit.issues.listLabelsOnIssue).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual([{ name: 'bug' }, { name: 'feature' }]);
});

test('it delegates adding labels and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.addLabels.mockResolvedValue({ data: { id: 1 } });

  const params = { owner: 'o', repo: 'r', issue_number: 1, labels: ['bug'] };
  const result = await client.issues.addLabels(params);

  expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ id: 1 });
});

test('it delegates removing a label and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.removeLabel.mockResolvedValue({ data: [] });

  const params = { owner: 'o', repo: 'r', issue_number: 1, name: 'bug' };
  const result = await client.issues.removeLabel(params);

  expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual([]);
});

test('it delegates creating a comment and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.issues.createComment.mockResolvedValue({ data: { id: 555 } });

  const params = { owner: 'o', repo: 'r', issue_number: 42, body: 'Nice work!' };
  const result = await client.issues.createComment(params);

  expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ id: 555 });
});

// ---------------------------------------------------------------------------
// Pulls
// ---------------------------------------------------------------------------

test('it delegates pull request listing and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.list.mockResolvedValue({
    data: [
      {
        number: 10,
        title: 'Fix bug',
        html_url: 'https://github.com/o/r/pull/10',
        user: { login: 'author1' },
        head: { sha: 'abc123', ref: 'fix-bug' },
        body: 'Closes #1',
        draft: false,
      },
      {
        number: 11,
        title: 'WIP feature',
        html_url: 'https://github.com/o/r/pull/11',
        user: null,
        head: { sha: 'def456', ref: 'wip-feature' },
        body: null,
        draft: true,
      },
    ],
  });

  const params = { owner: 'o', repo: 'r', state: 'open' as const, per_page: 100 };
  const result = await client.pulls.list(params);

  expect(mockOctokit.pulls.list).toHaveBeenCalledWith(params);
  expect(result.data).toHaveLength(2);
  expect(result.data[0]).toStrictEqual({
    number: 10,
    title: 'Fix bug',
    html_url: 'https://github.com/o/r/pull/10',
    user: { login: 'author1' },
    head: { sha: 'abc123', ref: 'fix-bug' },
    body: 'Closes #1',
    draft: false,
  });
  expect(result.data[1]).toStrictEqual({
    number: 11,
    title: 'WIP feature',
    html_url: 'https://github.com/o/r/pull/11',
    user: null,
    head: { sha: 'def456', ref: 'wip-feature' },
    body: null,
    draft: true,
  });
});

test('it delegates pull request retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.get.mockResolvedValue({
    data: {
      number: 10,
      title: 'Fix bug',
      changed_files: 3,
      html_url: 'https://github.com/o/r/pull/10',
      user: { login: 'dev' },
      head: { sha: 'abc123', ref: 'feature-branch' },
      body: 'Closes #5',
    },
  });

  const params = { owner: 'o', repo: 'r', pull_number: 10 };
  const result = await client.pulls.get(params);

  expect(mockOctokit.pulls.get).toHaveBeenCalledWith(params);
  expect(result.data.number).toBe(10);
  expect(result.data.title).toBe('Fix bug');
  expect(result.data.changed_files).toBe(3);
  expect(result.data.user).toStrictEqual({ login: 'dev' });
  expect(result.data.head.sha).toBe('abc123');
  expect(result.data.body).toBe('Closes #5');
});

test('it delegates pull request files listing and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.listFiles.mockResolvedValue({
    data: [
      {
        filename: 'src/index.ts',
        status: 'modified',
        patch: '@@ -1,3 +1,3 @@\n-old\n+new',
        additions: 1,
        deletions: 1,
      },
      { filename: 'package.json', status: 'added', patch: undefined, additions: 10, deletions: 0 },
    ],
  });

  const params = { owner: 'o', repo: 'r', pull_number: 10, per_page: 100 };
  const result = await client.pulls.listFiles(params);

  expect(mockOctokit.pulls.listFiles).toHaveBeenCalledWith(params);
  expect(result.data).toHaveLength(2);
  expect(result.data[0]?.filename).toBe('src/index.ts');
  expect(result.data[0]?.status).toBe('modified');
  expect(result.data[0]?.patch).toBe('@@ -1,3 +1,3 @@\n-old\n+new');
  expect(result.data[1]?.filename).toBe('package.json');
  expect(result.data[1]?.status).toBe('added');
  expect(result.data[1]?.patch).toBeUndefined();
});

test('it delegates pull request reviews listing and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.listReviews.mockResolvedValue({
    data: [
      {
        id: 1,
        user: { login: 'reviewer1' },
        state: 'APPROVED',
        body: 'Looks good',
        submitted_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        user: { login: 'reviewer2' },
        state: 'CHANGES_REQUESTED',
        body: null,
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ],
  });

  const params = { owner: 'o', repo: 'r', pull_number: 10, per_page: 100 };
  const result = await client.pulls.listReviews(params);

  expect(mockOctokit.pulls.listReviews).toHaveBeenCalledWith(params);
  expect(result.data).toHaveLength(2);
  expect(result.data[0]?.id).toBe(1);
  expect(result.data[0]?.user).toStrictEqual({ login: 'reviewer1' });
  expect(result.data[0]?.state).toBe('APPROVED');
  expect(result.data[0]?.body).toBe('Looks good');
  expect(result.data[0]?.submitted_at).toBe('2026-01-01T00:00:00Z');
  expect(result.data[1]?.id).toBe(2);
  expect(result.data[1]?.body).toBeNull();
  expect(result.data[1]?.submitted_at).toBe('2026-01-02T00:00:00Z');
});

test('it delegates pull request review comments listing and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.listReviewComments.mockResolvedValue({
    data: [
      {
        id: 1,
        user: { login: 'commenter1' },
        body: 'Please fix this',
        path: 'src/index.ts',
        line: 42,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        user: { login: 'commenter2' },
        body: 'Outdated comment',
        path: 'src/old.ts',
        line: undefined,
        created_at: '2026-01-02T00:00:00Z',
      },
    ],
  });

  const params = { owner: 'o', repo: 'r', pull_number: 10, per_page: 100 };
  const result = await client.pulls.listReviewComments(params);

  expect(mockOctokit.pulls.listReviewComments).toHaveBeenCalledWith(params);
  expect(result.data).toHaveLength(2);
  expect(result.data[0]?.id).toBe(1);
  expect(result.data[0]?.user).toStrictEqual({ login: 'commenter1' });
  expect(result.data[0]?.body).toBe('Please fix this');
  expect(result.data[0]?.path).toBe('src/index.ts');
  expect(result.data[0]?.line).toBe(42);
  expect(result.data[1]?.id).toBe(2);
  expect(result.data[1]?.line).toBeNull();
});

test('it delegates pull request creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.create.mockResolvedValue({
    data: {
      number: 5,
      title: 'New PR',
      html_url: 'https://github.com/o/r/pull/5',
      user: { login: 'author' },
      head: { sha: 'sha123', ref: 'feature-branch' },
      body: 'Closes #1',
      draft: false,
      extra_field: 'ignored',
    },
  });

  const params = {
    owner: 'o',
    repo: 'r',
    title: 'New PR',
    body: 'Closes #1',
    head: 'feature-branch',
    base: 'main',
  };
  const result = await client.pulls.create(params);

  expect(mockOctokit.pulls.create).toHaveBeenCalledWith(params);
  expect(result.data.number).toBe(5);
  expect(result.data.title).toBe('New PR');
  expect(result.data.head.sha).toBe('sha123');
  expect(result.data.draft).toBe(false);
});

test('it delegates pull request update and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.update.mockResolvedValue({
    data: { number: 5, body: 'Updated body' },
  });

  const params = { owner: 'o', repo: 'r', pull_number: 5, body: 'Updated body' };
  const result = await client.pulls.update(params);

  expect(mockOctokit.pulls.update).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ number: 5, body: 'Updated body' });
});

test('it delegates review creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.createReview.mockResolvedValue({
    data: { id: 789, node_id: 'ignored' },
  });

  const params: PullsCreateReviewParams = {
    owner: 'o',
    repo: 'r',
    pull_number: 5,
    body: 'Looks good',
    event: 'APPROVE',
  };
  const result = await client.pulls.createReview(params);

  expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ id: 789 });
});

test('it delegates review dismissal and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.pulls.dismissReview.mockResolvedValue({ data: { id: 789 } });

  const params = {
    owner: 'o',
    repo: 'r',
    pull_number: 5,
    review_id: 789,
    message: 'Replaced',
  };
  const result = await client.pulls.dismissReview(params);

  expect(mockOctokit.pulls.dismissReview).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ id: 789 });
});

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

test('it delegates combined status retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.repos.getCombinedStatusForRef.mockResolvedValue({
    data: { state: 'success', total_count: 2 },
  });

  const params = { owner: 'o', repo: 'r', ref: 'abc123' };
  const result = await client.repos.getCombinedStatusForRef(params);

  expect(mockOctokit.repos.getCombinedStatusForRef).toHaveBeenCalledWith(params);
  expect(result.data.state).toBe('success');
  expect(result.data.total_count).toBe(2);
});

test('it delegates content retrieval and returns content and sha', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.repos.getContent.mockResolvedValue({
    data: { sha: 'file-sha-1', content: 'base64content', encoding: 'base64', type: 'file' },
  });

  const params = { owner: 'o', repo: 'r', path: 'docs/spec.md', ref: 'main' };
  const result = await client.repos.getContent(params);

  expect(mockOctokit.repos.getContent).toHaveBeenCalledWith(params);
  expect(result.data.content).toBe('base64content');
  expect(result.data.sha).toBe('file-sha-1');
});

test('it returns sha without content for directory responses', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.repos.getContent.mockResolvedValue({
    data: { sha: 'dir-sha-1', type: 'dir' },
  });

  const result = await client.repos.getContent({
    owner: 'o',
    repo: 'r',
    path: 'docs/',
    ref: 'main',
  });

  expect(result.data.sha).toBe('dir-sha-1');
  expect(result.data.content).toBeUndefined();
});

test('it returns an empty data object when neither content nor sha is present', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.repos.getContent.mockResolvedValue({
    data: [{ name: 'file.md' }],
  });

  const result = await client.repos.getContent({
    owner: 'o',
    repo: 'r',
    path: 'docs/',
    ref: 'main',
  });

  expect(result.data.content).toBeUndefined();
  expect(result.data.sha).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

test('it delegates check runs listing and returns the narrowed result with name and details url', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.checks.listForRef.mockResolvedValue({
    data: {
      total_count: 2,
      check_runs: [
        {
          status: 'completed',
          conclusion: 'success',
          name: 'CI',
          details_url: 'https://ci.example.com/1',
        },
        { status: 'in_progress', conclusion: null, name: 'Lint', details_url: undefined },
      ],
    },
  });

  const params = { owner: 'o', repo: 'r', ref: 'abc123' };
  const result = await client.checks.listForRef(params);

  expect(mockOctokit.checks.listForRef).toHaveBeenCalledWith(params);
  expect(result.data.total_count).toBe(2);
  expect(result.data.check_runs).toHaveLength(2);
  expect(result.data.check_runs[0]?.name).toBe('CI');
  expect(result.data.check_runs[0]?.details_url).toBe('https://ci.example.com/1');
  expect(result.data.check_runs[0]?.conclusion).toBe('success');
  expect(result.data.check_runs[1]?.name).toBe('Lint');
  expect(result.data.check_runs[1]?.details_url).toBeNull();
  expect(result.data.check_runs[1]?.conclusion).toBeNull();
});

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

test('it delegates tree retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.getTree.mockResolvedValue({
    data: {
      sha: 'tree-sha-1',
      tree: [
        { path: 'docs/spec.md', sha: 'file-sha-1', type: 'blob', size: 1024 },
        { path: 'src', sha: 'dir-sha-1', type: 'tree' },
      ],
      truncated: false,
    },
  });

  const params = { owner: 'o', repo: 'r', tree_sha: 'tree-sha-1', recursive: '1' };
  const result = await client.git.getTree(params);

  expect(mockOctokit.git.getTree).toHaveBeenCalledWith(params);
  expect(result.data.sha).toBe('tree-sha-1');
  expect(result.data.tree).toHaveLength(2);
  expect(result.data.tree[0]?.path).toBe('docs/spec.md');
  expect(result.data.tree[1]?.type).toBe('tree');
});

test('it delegates ref retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.getRef.mockResolvedValue({
    data: {
      ref: 'refs/heads/main',
      object: { sha: 'commit-sha-1', type: 'commit' },
    },
  });

  const params = { owner: 'o', repo: 'r', ref: 'heads/main' };
  const result = await client.git.getRef(params);

  expect(mockOctokit.git.getRef).toHaveBeenCalledWith(params);
  expect(result.data.object.sha).toBe('commit-sha-1');
});

test('it delegates blob retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.getBlob.mockResolvedValue({
    data: {
      content: 'base64data',
      encoding: 'base64',
      sha: 'blob-sha',
      size: 42,
    },
  });

  const params = { owner: 'o', repo: 'r', file_sha: 'blob-sha' };
  const result = await client.git.getBlob(params);

  expect(mockOctokit.git.getBlob).toHaveBeenCalledWith(params);
  expect(result.data.content).toBe('base64data');
  expect(result.data.encoding).toBe('base64');
});

test('it delegates commit retrieval and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.getCommit.mockResolvedValue({
    data: {
      sha: 'commit-sha',
      tree: { sha: 'tree-sha', url: 'https://api.github.com/...' },
      message: 'test commit',
    },
  });

  const params = { owner: 'o', repo: 'r', commit_sha: 'commit-sha' };
  const result = await client.git.getCommit(params);

  expect(mockOctokit.git.getCommit).toHaveBeenCalledWith(params);
  expect(result.data.sha).toBe('commit-sha');
  expect(result.data.tree.sha).toBe('tree-sha');
});

test('it delegates blob creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.createBlob.mockResolvedValue({
    data: { sha: 'new-blob-sha', url: 'https://api.github.com/...' },
  });

  const params = { owner: 'o', repo: 'r', content: 'file content', encoding: 'utf-8' };
  const result = await client.git.createBlob(params);

  expect(mockOctokit.git.createBlob).toHaveBeenCalledWith(params);
  expect(result.data.sha).toBe('new-blob-sha');
});

test('it delegates tree creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.createTree.mockResolvedValue({
    data: { sha: 'new-tree-sha', url: 'https://api.github.com/...' },
  });

  const params: GitCreateTreeParams = {
    owner: 'o',
    repo: 'r',
    base_tree: 'base-sha',
    tree: [{ path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'blob-sha' }],
  };
  const result = await client.git.createTree(params);

  expect(mockOctokit.git.createTree).toHaveBeenCalledWith(params);
  expect(result.data.sha).toBe('new-tree-sha');
});

test('it delegates commit creation and returns the narrowed result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.createCommit.mockResolvedValue({
    data: { sha: 'new-commit-sha', url: 'https://api.github.com/...' },
  });

  const params = {
    owner: 'o',
    repo: 'r',
    message: 'test commit',
    tree: 'tree-sha',
    parents: ['parent-sha'],
  };
  const result = await client.git.createCommit(params);

  expect(mockOctokit.git.createCommit).toHaveBeenCalledWith(params);
  expect(result.data.sha).toBe('new-commit-sha');
});

test('it delegates ref creation and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.createRef.mockResolvedValue({
    data: { ref: 'refs/heads/new-branch', object: { sha: 'sha' } },
  });

  const params = { owner: 'o', repo: 'r', ref: 'refs/heads/new-branch', sha: 'sha' };
  const result = await client.git.createRef(params);

  expect(mockOctokit.git.createRef).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ ref: 'refs/heads/new-branch', object: { sha: 'sha' } });
});

test('it delegates ref update and returns the result', async () => {
  const { client, mockOctokit } = setupTest();

  mockOctokit.git.updateRef.mockResolvedValue({
    data: { ref: 'refs/heads/branch', object: { sha: 'new-sha' } },
  });

  const params = { owner: 'o', repo: 'r', ref: 'heads/branch', sha: 'new-sha', force: true };
  const result = await client.git.updateRef(params);

  expect(mockOctokit.git.updateRef).toHaveBeenCalledWith(params);
  expect(result.data).toStrictEqual({ ref: 'refs/heads/branch', object: { sha: 'new-sha' } });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

test('it propagates errors from the underlying client without modification', async () => {
  const { client, mockOctokit } = setupTest();

  const originalError = new Error('GitHub API rate limited');
  mockOctokit.issues.get.mockRejectedValue(originalError);

  const error = await client.issues.get({ owner: 'o', repo: 'r', issue_number: 1 }).catch((e) => e);

  expect(error).toBe(originalError);
});
