import type { SpecChanged } from '../engine/state-store/types.ts';

export function buildSpecChangedEvent(overrides?: Partial<SpecChanged>): SpecChanged {
  return {
    type: 'specChanged',
    filePath: 'docs/specs/test.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
    changeType: 'added',
    commitSHA: 'commit-1',
    ...overrides,
  };
}
