import { match } from 'ts-pattern';
import { isWorkItemUnblocked } from '../state-store/selectors/is-work-item-unblocked.ts';
import type {
  EngineCommand,
  EngineEvent,
  EngineState,
  TransitionWorkItemStatus,
} from '../state-store/types.ts';

export function handleReadiness(event: EngineEvent, state: EngineState): EngineCommand[] {
  return match(event)
    .with({ type: 'workItemChanged' }, (e) => {
      if (e.newStatus !== 'pending') {
        return [];
      }

      if (!isWorkItemUnblocked(state, e.workItem)) {
        return [];
      }

      return [buildReadyTransition(e.workItemID)];
    })
    .otherwise(() => []);
}

function buildReadyTransition(workItemID: string): TransitionWorkItemStatus {
  return {
    command: 'transitionWorkItemStatus',
    workItemID,
    newStatus: 'ready',
  };
}
