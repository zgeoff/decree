import type { Spec, SpecChanged } from '../state-store/types.ts';

export function buildAddedSpecEvent(spec: Spec, commitSHA: string): SpecChanged {
  return {
    type: 'specChanged',
    filePath: spec.filePath,
    blobSHA: spec.blobSHA,
    frontmatterStatus: spec.frontmatterStatus,
    changeType: 'added',
    commitSHA,
  };
}
