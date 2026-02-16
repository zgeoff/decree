import type { EngineState, Spec } from '../types.ts';

export function getSpecsRequiringPlanning(state: EngineState): Spec[] {
  const results: Spec[] = [];

  for (const spec of state.specs.values()) {
    if (spec.frontmatterStatus === 'approved') {
      const lastPlannedSHA = state.lastPlannedSHAs.get(spec.filePath);

      if (lastPlannedSHA === undefined || lastPlannedSHA !== spec.blobSHA) {
        results.push(spec);
      }
    }
  }

  return results;
}
