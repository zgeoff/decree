import equal from 'fast-deep-equal';
import type { Revision, RevisionChanged } from '../state-store/types.ts';
import { buildChangedRevisionEvent } from '../utils/build-changed-revision-event.ts';
import { buildNewRevisionEvent } from '../utils/build-new-revision-event.ts';
import { buildRemovedRevisionEvent } from '../utils/build-removed-revision-event.ts';
import type { RevisionPoller, RevisionPollerConfig } from './types.ts';

const MILLISECONDS_PER_SECOND = 1000;

export function createRevisionPoller(config: RevisionPollerConfig): RevisionPoller {
  const log = config.logger.child({ component: 'revisionPoller' });
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

      let eventsEmitted = 0;
      const countingEnqueue = (event: RevisionChanged): void => {
        eventsEmitted += 1;
        config.enqueue(event);
      };

      detectNewAndChangedRevisions(providerMap, storedRevisions, countingEnqueue);
      detectRemovedRevisions(providerMap, storedRevisions, countingEnqueue);

      log.info({ eventsEmitted }, 'poll cycle completed');
    } catch (error: unknown) {
      log.warn({ err: error }, 'poll cycle failed');
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
