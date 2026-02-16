import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../../test-utils/create-mock-github-client.ts';
import type { TreeEntryOverrides } from '../test-utils/build-tree-entry.ts';
import { buildTreeEntry } from '../test-utils/build-tree-entry.ts';
import type { SpecReaderConfig } from './create-spec-reader.ts';
import { createSpecReader } from './create-spec-reader.ts';

function buildConfig(): SpecReaderConfig {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    specsDir: 'docs/specs',
    defaultBranch: 'main',
  };
}

function encodeContent(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

function buildSpecContent(status: string): string {
  return `---\ntitle: Test Spec\nversion: 0.1.0\nstatus: ${status}\n---\n\n# Test\n\nContent.\n`;
}

function setupTest(overrides?: {
  dirSHA?: string;
  treeSHA?: string;
  treeEntries?: TreeEntryOverrides[];
  blobContents?: Record<string, string>;
}): {
  reader: ReturnType<typeof createSpecReader>;
  client: ReturnType<typeof createMockGitHubClient>;
} {
  const dirSHA = overrides?.dirSHA ?? 'dir-sha-1';
  const treeSHA = overrides?.treeSHA ?? dirSHA;
  const entries = (overrides?.treeEntries ?? []).map((e) => buildTreeEntry(e));
  const blobContents = overrides?.blobContents ?? {};

  const client = createMockGitHubClient();

  vi.mocked(client.repos.getContent).mockResolvedValue({ data: { sha: dirSHA } });

  vi.mocked(client.git.getTree).mockResolvedValue({
    data: { sha: treeSHA, tree: entries },
  });

  vi.mocked(client.git.getBlob).mockImplementation(async (params) => {
    const content = blobContents[params.file_sha] ?? buildSpecContent('draft');
    return { data: { content: encodeContent(content), encoding: 'base64' } };
  });

  const reader = createSpecReader({ client, config: buildConfig() });
  return { reader, client };
}

// --- listSpecs ---

test('it returns all files recursively in the configured specs directory', async () => {
  const { reader } = setupTest({
    treeEntries: [
      { path: 'decree/workflow.md', sha: 'sha-1', type: 'blob' },
      { path: 'decree/architecture.md', sha: 'sha-2', type: 'blob' },
    ],
  });

  const result = await reader.listSpecs();

  expect(result).toHaveLength(2);
});

test('it returns file path as full repo-relative path', async () => {
  const { reader } = setupTest({
    treeEntries: [{ path: 'decree/workflow.md', sha: 'sha-1', type: 'blob' }],
  });

  const result = await reader.listSpecs();

  expect(result[0]?.filePath).toBe('docs/specs/decree/workflow.md');
});

test('it parses frontmatter status from file content', async () => {
  const { reader } = setupTest({
    treeEntries: [{ path: 'workflow.md', sha: 'sha-1', type: 'blob' }],
    blobContents: { 'sha-1': buildSpecContent('approved') },
  });

  const result = await reader.listSpecs();

  expect(result[0]?.frontmatterStatus).toBe('approved');
});

test('it defaults to draft for files without parseable frontmatter', async () => {
  const { reader } = setupTest({
    treeEntries: [{ path: 'readme.md', sha: 'sha-1', type: 'blob' }],
    blobContents: { 'sha-1': '# Just a readme\n\nNo frontmatter here.' },
  });

  const result = await reader.listSpecs();

  expect(result[0]?.frontmatterStatus).toBe('draft');
});

test('it excludes tree entries that are not blobs', async () => {
  const { reader } = setupTest({
    treeEntries: [
      { path: 'subdir', sha: 'tree-sha', type: 'tree' },
      { path: 'workflow.md', sha: 'blob-sha', type: 'blob' },
    ],
  });

  const result = await reader.listSpecs();

  expect(result).toHaveLength(1);
  expect(result[0]?.filePath).toBe('docs/specs/workflow.md');
});

test('it returns cached result when tree SHA is unchanged', async () => {
  const { reader, client } = setupTest({
    dirSHA: 'stable-sha',
    treeEntries: [{ path: 'workflow.md', sha: 'sha-1', type: 'blob' }],
  });

  const result1 = await reader.listSpecs();
  const result2 = await reader.listSpecs();

  expect(result1).toStrictEqual(result2);
  expect(client.git.getBlob).toHaveBeenCalledTimes(1);
});

test('it re-fetches when tree SHA changes', async () => {
  const client = createMockGitHubClient();

  let callCount = 0;
  vi.mocked(client.repos.getContent).mockImplementation(async () => {
    callCount += 1;
    return { data: { sha: `dir-sha-${callCount}` } };
  });

  vi.mocked(client.git.getTree).mockResolvedValue({
    data: {
      sha: 'tree-sha',
      tree: [buildTreeEntry({ path: 'workflow.md', sha: 'sha-1', type: 'blob' })],
    },
  });

  vi.mocked(client.git.getBlob).mockResolvedValue({
    data: { content: encodeContent(buildSpecContent('draft')), encoding: 'base64' },
  });

  const reader = createSpecReader({ client, config: buildConfig() });

  await reader.listSpecs();
  await reader.listSpecs();

  expect(client.git.getBlob).toHaveBeenCalledTimes(2);
});

test('it fails entirely when any file content fetch fails after retries', async () => {
  const { reader, client } = setupTest({
    treeEntries: [
      { path: 'good.md', sha: 'sha-1', type: 'blob' },
      { path: 'bad.md', sha: 'sha-2', type: 'blob' },
    ],
  });

  vi.mocked(client.git.getBlob).mockRejectedValue({ status: 422 });

  await expect(reader.listSpecs()).rejects.toMatchObject({ status: 422 });
});

test('it maps blob SHA from tree entry to spec', async () => {
  const { reader } = setupTest({
    treeEntries: [{ path: 'workflow.md', sha: 'deadbeef', type: 'blob' }],
  });

  const result = await reader.listSpecs();

  expect(result[0]?.blobSHA).toBe('deadbeef');
});

test('it returns domain types without GitHub-specific fields', async () => {
  const { reader } = setupTest({
    treeEntries: [{ path: 'v2/architecture.md', sha: 'sha999', type: 'blob' }],
    blobContents: { sha999: buildSpecContent('approved') },
  });

  const result = await reader.listSpecs();

  expect(result[0]).toStrictEqual({
    filePath: 'docs/specs/v2/architecture.md',
    blobSHA: 'sha999',
    frontmatterStatus: 'approved',
  });
});
