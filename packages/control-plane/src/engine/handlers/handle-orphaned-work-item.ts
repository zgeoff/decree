import { isAgentRunningForWorkItem } from '../state-store/selectors/is-agent-running-for-work-item.ts';
import type { EngineCommand, EngineEvent, EngineState } from '../state-store/types.ts';

export function handleOrphanedWorkItem(event: EngineEvent, state: EngineState): EngineCommand[] {
  if (event.type !== 'workItemChanged') {
    return [];
  }

  if (event.newStatus !== 'in-progress') {
    return [];
  }

  if (isAgentRunningForWorkItem(state, event.workItemID)) {
    return [];
  }

  return [
    { command: 'transitionWorkItemStatus', workItemID: event.workItemID, newStatus: 'pending' },
  ];
}
