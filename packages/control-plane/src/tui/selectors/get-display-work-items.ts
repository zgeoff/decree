import type {
  AgentRun,
  EngineState,
  ImplementorRun,
  ReviewerRun,
} from '../../engine/state-store/types.ts';
import type { DisplayWorkItem } from '../types.ts';
import { deriveDisplayStatus } from '../types.ts';
import { ACTION_STATUSES } from './types.ts';

export function getDisplayWorkItems(state: EngineState): DisplayWorkItem[] {
  const result: DisplayWorkItem[] = [];
  const runsByWorkItem = groupRunsByWorkItem(state.agentRuns);

  for (const workItem of state.workItems.values()) {
    const runs = runsByWorkItem.get(workItem.id) ?? [];
    const displayStatus = deriveDisplayStatus(workItem, runs);

    if (displayStatus !== null) {
      const section = ACTION_STATUSES.has(displayStatus) ? 'action' : 'agents';

      const linkedRevision =
        workItem.linkedRevision !== null
          ? (state.revisions.get(workItem.linkedRevision) ?? null)
          : null;

      const latestRun = findLatestRun(runs);
      const dispatchCount = runs.length;

      result.push({
        workItem,
        displayStatus,
        section,
        linkedRevision,
        latestRun,
        dispatchCount,
      });
    }
  }

  return result;
}

function groupRunsByWorkItem(
  agentRuns: Map<string, AgentRun>,
): Map<string, Array<ImplementorRun | ReviewerRun>> {
  const grouped = new Map<string, Array<ImplementorRun | ReviewerRun>>();

  for (const run of agentRuns.values()) {
    if (run.role !== 'planner') {
      const existing = grouped.get(run.workItemID);
      if (existing !== undefined) {
        existing.push(run);
      } else {
        grouped.set(run.workItemID, [run]);
      }
    }
  }

  return grouped;
}

function findLatestRun(runs: Array<ImplementorRun | ReviewerRun>): AgentRun | null {
  if (runs.length === 0) {
    return null;
  }

  return runs.reduce((latest, current) =>
    current.startedAt > latest.startedAt ? current : latest,
  );
}
