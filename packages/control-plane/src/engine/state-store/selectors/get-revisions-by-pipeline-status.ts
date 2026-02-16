import type { EngineState, PipelineStatus, Revision } from '../types.ts';

export function getRevisionsByPipelineStatus(
  state: EngineState,
  status: PipelineStatus,
): Revision[] {
  const results: Revision[] = [];

  for (const revision of state.revisions.values()) {
    if (revision.pipeline !== null && revision.pipeline.status === status) {
      results.push(revision);
    }
  }

  return results;
}
