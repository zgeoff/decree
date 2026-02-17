import { expect, test } from 'vitest';
import { buildSpec } from './build-spec.ts';

test('it returns a spec with default values', () => {
  const spec = buildSpec();

  expect(spec).toStrictEqual({
    filePath: 'docs/specs/test.md',
    blobSHA: 'blob-sha-1',
    frontmatterStatus: 'approved',
  });
});

test('it applies overrides to the spec', () => {
  const spec = buildSpec({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-99' });

  expect(spec).toMatchObject({ filePath: 'docs/specs/engine.md', blobSHA: 'sha-99' });
});
