import equal from 'fast-deep-equal';
import type { Revision, RevisionChanged } from '../state-store/types.ts';
import type { RevisionPoller, RevisionPollerConfig } from './types.ts';

const MILLISECONDS_PER_SECOND = 1000;

export function createRevisionPoller(config: RevisionPollerConfig): RevisionPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  async function poll(): Promise<void> {
    try {
      const providerRevisions = await config.reader.listRevisions();
      const state = config.getState();
      const storedRevisions = state.revisions;

      const providerMap = new Map<string, Revision>();
      for (const revision of providerRevisions) {
        providerMap.set(revision.id, revision);
      }

      detectNewAndChangedRevisions(providerMap, storedRevisions, config.enqueue);
      detectRemovedRevisions(providerMap, storedRevisions, config.enqueue);
    } catch {
      // Provider reader failed — skip this cycle, next interval proceeds normally
    }

    if (!started) {
      started = true;
      timer = setInterval(async () => {
        await poll();
      }, config.interval * MILLISECONDS_PER_SECOND);
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { poll, stop };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectNewAndChangedRevisions(
  providerMap: Map<string, Revision>,
  storedRevisions: Map<string, Revision>,
  enqueue: (event: RevisionChanged) => void,
): void {
  for (const [id, providerRevision] of providerMap) {
    const storedRevision = storedRevisions.get(id);

    if (!storedRevision) {
      enqueue(buildNewRevisionEvent(providerRevision));
    } else if (!equal(providerRevision, storedRevision)) {
      enqueue(buildChangedRevisionEvent(providerRevision, storedRevision));
    }
  }
}

function detectRemovedRevisions(
  providerMap: Map<string, Revision>,
  storedRevisions: Map<string, Revision>,
  enqueue: (event: RevisionChanged) => void,
): void {
  for (const [id, storedRevision] of storedRevisions) {
    if (!providerMap.has(id)) {
      enqueue(buildRemovedRevisionEvent(storedRevision));
    }
  }
}

function buildNewRevisionEvent(revision: Revision): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: revision.id,
    workItemID: revision.workItemID,
    revision,
    oldPipelineStatus: null,
    newPipelineStatus: revision.pipeline?.status ?? null,
  };
}

function buildChangedRevisionEvent(
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

function buildRemovedRevisionEvent(storedRevision: Revision): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: storedRevision.id,
    workItemID: storedRevision.workItemID,
    revision: storedRevision,
    oldPipelineStatus: storedRevision.pipeline?.status ?? null,
    newPipelineStatus: null,
  };
}
