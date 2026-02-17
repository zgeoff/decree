import type { Revision, RevisionChanged } from '../state-store/types.ts';

export function buildRemovedRevisionEvent(storedRevision: Revision): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: storedRevision.id,
    workItemID: storedRevision.workItemID,
    revision: storedRevision,
    oldPipelineStatus: storedRevision.pipeline?.status ?? null,
    newPipelineStatus: null,
  };
}
