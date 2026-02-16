import { expect, test } from 'vitest';
import type { GitHubTreeEntryInput } from './map-tree-entry-to-spec.ts';
import { mapTreeEntryToSpec } from './map-tree-entry-to-spec.ts';

function buildEntry(overrides?: Partial<GitHubTreeEntryInput>): GitHubTreeEntryInput {
  return {
    path: overrides?.path ?? 'decree/workflow.md',
    sha: overrides?.sha ?? 'blob-sha-1',
  };
}

function buildSpecContent(status: string): string {
  return `---\ntitle: Test Spec\nversion: 0.1.0\nstatus: ${status}\n---\n\n# Test Spec\n\nContent here.\n`;
}

test('it builds a full repo-relative file path from specs dir and entry path', () => {
  const entry = buildEntry({ path: 'decree/workflow.md' });
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('draft'),
  });
  expect(result.filePath).toBe('docs/specs/decree/workflow.md');
});

test('it handles specs dir with trailing slash', () => {
  const entry = buildEntry({ path: 'workflow.md' });
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs/',
    content: buildSpecContent('draft'),
  });
  expect(result.filePath).toBe('docs/specs/workflow.md');
});

test('it maps tree entry sha to blob SHA', () => {
  const entry = buildEntry({ sha: 'deadbeef' });
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('draft'),
  });
  expect(result.blobSHA).toBe('deadbeef');
});

test('it parses frontmatter status approved from file content', () => {
  const entry = buildEntry();
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('approved'),
  });
  expect(result.frontmatterStatus).toBe('approved');
});

test('it parses frontmatter status deprecated from file content', () => {
  const entry = buildEntry();
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('deprecated'),
  });
  expect(result.frontmatterStatus).toBe('deprecated');
});

test('it defaults to draft when file has no parseable frontmatter', () => {
  const entry = buildEntry();
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: '# Just a heading\n\nNo frontmatter.',
  });
  expect(result.frontmatterStatus).toBe('draft');
});

test('it defaults to draft when frontmatter has no status field', () => {
  const entry = buildEntry();
  const content = '---\ntitle: Test\nversion: 0.1.0\n---\n\n# Content';
  const result = mapTreeEntryToSpec(entry, { specsDir: 'docs/specs', content });
  expect(result.frontmatterStatus).toBe('draft');
});

test('it defaults to draft when frontmatter status is unrecognized', () => {
  const entry = buildEntry();
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('unknown-status'),
  });
  expect(result.frontmatterStatus).toBe('draft');
});

test('it returns a complete spec with all fields mapped', () => {
  const entry = buildEntry({ path: 'v2/architecture.md', sha: 'sha999' });
  const result = mapTreeEntryToSpec(entry, {
    specsDir: 'docs/specs',
    content: buildSpecContent('approved'),
  });
  expect(result).toStrictEqual({
    filePath: 'docs/specs/v2/architecture.md',
    blobSHA: 'sha999',
    frontmatterStatus: 'approved',
  });
});

test('it handles empty content by defaulting to draft', () => {
  const entry = buildEntry();
  const result = mapTreeEntryToSpec(entry, { specsDir: 'docs/specs', content: '' });
  expect(result.frontmatterStatus).toBe('draft');
});
