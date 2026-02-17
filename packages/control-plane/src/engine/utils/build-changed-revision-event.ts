import type { Revision, RevisionChanged } from '../state-store/types.ts';

export function buildChangedRevisionEvent(
  providerRevision: Revision,
  storedRevision: Revision,
): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: providerRevision.id,
    workItemID: providerRevision.workItemID,
    revision: providerRevision,
    oldPipelineStatus: storedRevision.pipeline?.status ?? null,
    newPipelineStatus: providerRevision.pipeline?.status ?? null,
  };
}
