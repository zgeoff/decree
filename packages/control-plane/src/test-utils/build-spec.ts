import type { Spec } from '../engine/state-store/types.ts';

export function buildSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    filePath: 'docs/specs/test.md',
    blobSHA: 'blob-sha-1',
    frontmatterStatus: 'approved',
    ...overrides,
  };
}
