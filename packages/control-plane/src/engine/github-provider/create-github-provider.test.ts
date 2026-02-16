import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../test-utils/create-mock-github-client.ts';
import type { GitHubClient } from '../github-client/types.ts';
import { createGitHubProvider } from './create-github-provider.ts';
import { createRevisionReader } from './readers/create-revision-reader.ts';
import { createSpecReader } from './readers/create-spec-reader.ts';
import { createWorkItemReader } from './readers/create-work-item-reader.ts';
import type { GitHubProviderConfig } from './types.ts';
import { createRevisionWriter } from './writers/create-revision-writer.ts';
import { createWorkItemWriter } from './writers/create-work-item-writer.ts';

let mockClient: GitHubClient;

vi.mock('../github-client/create-github-client.ts', () => ({
  createGitHubClient: vi.fn(() => mockClient),
}));

vi.mock('./readers/create-work-item-reader.ts', () => ({
  createWorkItemReader: vi.fn(() => ({
    listWorkItems: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkItemBody: vi.fn(),
  })),
}));

vi.mock('./readers/create-revision-reader.ts', () => ({
  createRevisionReader: vi.fn(() => ({
    listRevisions: vi.fn(),
    getRevision: vi.fn(),
    getRevisionFiles: vi.fn(),
  })),
}));

vi.mock('./readers/create-spec-reader.ts', () => ({
  createSpecReader: vi.fn(() => ({
    listSpecs: vi.fn(),
  })),
}));

vi.mock('./writers/create-work-item-writer.ts', () => ({
  createWorkItemWriter: vi.fn(() => ({
    transitionStatus: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItem: vi.fn(),
  })),
}));

vi.mock('./writers/create-revision-writer.ts', () => ({
  createRevisionWriter: vi.fn(() => ({
    createFromPatch: vi.fn(),
    updateBody: vi.fn(),
    postReview: vi.fn(),
    updateReview: vi.fn(),
    postComment: vi.fn(),
  })),
}));

function buildConfig(): GitHubProviderConfig {
  return {
    appID: 12_345,
    // biome-ignore lint/security/noSecrets: fake test key, not a real secret
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
    installationID: 67_890,
    owner: 'test-owner',
    repo: 'test-repo',
    specsDir: 'docs/specs',
    defaultBranch: 'main',
  };
}

function setupTest(): { config: GitHubProviderConfig; client: GitHubClient } {
  const config = buildConfig();
  const client = createMockGitHubClient();

  vi.mocked(client.apps.getAuthenticated).mockResolvedValue({
    data: { slug: 'my-app' },
  });

  mockClient = client;

  return { config, client };
}

test('it returns a provider with all five interface objects', async () => {
  const { config } = setupTest();

  const provider = await createGitHubProvider(config);

  expect(provider.workItemReader).toBeDefined();
  expect(provider.workItemWriter).toBeDefined();
  expect(provider.revisionReader).toBeDefined();
  expect(provider.revisionWriter).toBeDefined();
  expect(provider.specReader).toBeDefined();
});

test('it creates a client and wires all factories', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(vi.mocked(createWorkItemReader)).toHaveBeenCalled();
  expect(vi.mocked(createRevisionReader)).toHaveBeenCalled();
  expect(vi.mocked(createSpecReader)).toHaveBeenCalled();
  expect(vi.mocked(createWorkItemWriter)).toHaveBeenCalled();
  expect(vi.mocked(createRevisionWriter)).toHaveBeenCalled();
});

test('it resolves the bot username from the app slug', async () => {
  const { config, client } = setupTest();

  await createGitHubProvider(config);

  expect(client.apps.getAuthenticated).toHaveBeenCalledOnce();
});

test('it passes the bot username to the revision reader factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createRevisionReader).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({ botUsername: 'my-app[bot]' }),
    }),
  );
});

test('it passes owner and repo to the work item reader factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createWorkItemReader).toHaveBeenCalledWith(
    expect.objectContaining({
      config: { owner: 'test-owner', repo: 'test-repo' },
    }),
  );
});

test('it passes owner and repo to the work item writer factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createWorkItemWriter).toHaveBeenCalledWith(
    expect.objectContaining({
      config: { owner: 'test-owner', repo: 'test-repo' },
    }),
  );
});

test('it passes owner, repo, and bot username to the revision reader factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createRevisionReader).toHaveBeenCalledWith(
    expect.objectContaining({
      config: { owner: 'test-owner', repo: 'test-repo', botUsername: 'my-app[bot]' },
    }),
  );
});

test('it passes owner, repo, and default branch to the revision writer factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createRevisionWriter).toHaveBeenCalledWith(
    expect.objectContaining({
      config: {
        owner: 'test-owner',
        repo: 'test-repo',
        defaultBranch: 'main',
      },
    }),
  );
});

test('it passes owner, repo, specs dir, and default branch to the spec reader factory', async () => {
  const { config } = setupTest();

  await createGitHubProvider(config);

  expect(createSpecReader).toHaveBeenCalledWith(
    expect.objectContaining({
      config: {
        owner: 'test-owner',
        repo: 'test-repo',
        specsDir: 'docs/specs',
        defaultBranch: 'main',
      },
    }),
  );
});

test('it shares the same client instance across all reader and writer factories', async () => {
  const { config, client } = setupTest();

  await createGitHubProvider(config);

  const workItemReaderClient = vi.mocked(createWorkItemReader).mock.calls.at(-1)?.[0]?.client;
  const revisionReaderClient = vi.mocked(createRevisionReader).mock.calls.at(-1)?.[0]?.client;
  const specReaderClient = vi.mocked(createSpecReader).mock.calls.at(-1)?.[0]?.client;
  const workItemWriterClient = vi.mocked(createWorkItemWriter).mock.calls.at(-1)?.[0]?.client;
  const revisionWriterClient = vi.mocked(createRevisionWriter).mock.calls.at(-1)?.[0]?.client;

  expect(workItemReaderClient).toBe(client);
  expect(revisionReaderClient).toBe(client);
  expect(specReaderClient).toBe(client);
  expect(workItemWriterClient).toBe(client);
  expect(revisionWriterClient).toBe(client);
});
