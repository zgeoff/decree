import type { Spec } from '../state-store/types.ts';
import { buildAddedSpecEvent } from '../utils/build-added-spec-event.ts';
import { buildModifiedSpecEvent } from '../utils/build-modified-spec-event.ts';
import type { SpecPoller, SpecPollerConfig } from './types.ts';

export function createSpecPoller(config: SpecPollerConfig): SpecPoller {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    let specs: Spec[];

    try {
      specs = await config.reader.listSpecs();
    } catch {
      return;
    }

    const state = config.getState();
    const storedSpecs = state.specs;

    const changes = detectChanges(specs, storedSpecs);

    if (changes.length === 0) {
      return;
    }

    let commitSHA: string;
    try {
      commitSHA = await config.getDefaultBranchSHA();
    } catch {
      return;
    }

    for (const change of changes) {
      if (change.changeType === 'added') {
        config.enqueue(buildAddedSpecEvent(change.spec, commitSHA));
      } else {
        config.enqueue(buildModifiedSpecEvent(change.spec, commitSHA));
      }
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

interface DetectedChange {
  spec: Spec;
  changeType: 'added' | 'modified';
}

function detectChanges(providerSpecs: Spec[], storedSpecs: Map<string, Spec>): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const spec of providerSpecs) {
    const stored = storedSpecs.get(spec.filePath);

    if (!stored) {
      changes.push({ spec, changeType: 'added' });
    } else if (
      stored.blobSHA !== spec.blobSHA ||
      stored.frontmatterStatus !== spec.frontmatterStatus
    ) {
      changes.push({ spec, changeType: 'modified' });
    }
  }

  return changes;
}
