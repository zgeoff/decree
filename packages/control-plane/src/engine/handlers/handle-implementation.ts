import { match } from 'ts-pattern';
import type { EngineCommand, EngineEvent, EngineState } from '../state-store/types.ts';

export function handleImplementation(event: EngineEvent, _state: EngineState): EngineCommand[] {
  return match(event)
    .with({ type: 'workItemChanged' }, (e) => {
      if (e.newStatus !== 'ready') {
        return [];
      }
      return [{ command: 'requestImplementorRun' as const, workItemID: e.workItemID }];
    })
    .with({ type: 'implementorRequested' }, (e) => [
      {
        command: 'transitionWorkItemStatus' as const,
        workItemID: e.workItemID,
        newStatus: 'in-progress' as const,
      },
    ])
    .with({ type: 'implementorCompleted' }, (e) => [
      {
        command: 'applyImplementorResult' as const,
        workItemID: e.workItemID,
        result: e.result,
      },
    ])
    .with({ type: 'implementorFailed' }, (e) => [
      {
        command: 'transitionWorkItemStatus' as const,
        workItemID: e.workItemID,
        newStatus: 'pending' as const,
      },
    ])
    .otherwise(() => []);
}
