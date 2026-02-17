import { match } from 'ts-pattern';
import { getWorkItemsDependingOn } from '../state-store/selectors/get-work-items-depending-on.ts';
import { isWorkItemUnblocked } from '../state-store/selectors/is-work-item-unblocked.ts';
import type {
  EngineCommand,
  EngineEvent,
  EngineState,
  TransitionWorkItemStatus,
  WorkItem,
} from '../state-store/types.ts';

export function handleDependencyResolution(
  event: EngineEvent,
  state: EngineState,
): EngineCommand[] {
  return match(event)
    .with({ type: 'workItemChanged' }, (e) => {
      if (e.newStatus !== 'closed' && e.newStatus !== 'approved') {
        return [];
      }

      const dependents = getWorkItemsDependingOn(state, e.workItemID);

      return dependents
        .filter((dependent) => isEligibleForPromotion(state, dependent))
        .map((dependent) => buildReadyTransition(dependent));
    })
    .otherwise(() => []);
}

function isEligibleForPromotion(state: EngineState, dependent: WorkItem): boolean {
  if (dependent.status !== 'pending') {
    return false;
  }

  return isWorkItemUnblocked(state, dependent);
}

function buildReadyTransition(dependent: WorkItem): TransitionWorkItemStatus {
  return {
    command: 'transitionWorkItemStatus',
    workItemID: dependent.id,
    newStatus: 'ready',
  };
}
