import type { Revision, RevisionChanged } from '../state-store/types.ts';

export function buildNewRevisionEvent(revision: Revision): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: revision.id,
    workItemID: revision.workItemID,
    revision,
    oldPipelineStatus: null,
    newPipelineStatus: revision.pipeline?.status ?? null,
  };
}
