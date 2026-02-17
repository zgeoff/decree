import { match } from 'ts-pattern';
import type { EngineCommand, EngineEvent, EngineState } from '../state-store/types.ts';

export function handleUserDispatch(event: EngineEvent, state: EngineState): EngineCommand[] {
  return match(event)
    .with({ type: 'userRequestedImplementorRun' }, (e) => [
      { command: 'requestImplementorRun' as const, workItemID: e.workItemID },
    ])
    .with({ type: 'userCancelledRun' }, (e) => handleCancelledRun(e.sessionID, state))
    .with({ type: 'userTransitionedStatus' }, (e) => [
      {
        command: 'transitionWorkItemStatus' as const,
        workItemID: e.workItemID,
        newStatus: e.newStatus,
      },
    ])
    .otherwise(() => []);
}

function handleCancelledRun(sessionID: string, state: EngineState): EngineCommand[] {
  const run = state.agentRuns.get(sessionID);

  if (!run) {
    return [];
  }

  return match(run)
    .with({ role: 'planner' }, () => [{ command: 'cancelPlannerRun' as const }])
    .with({ role: 'implementor' }, (r) => [
      { command: 'cancelImplementorRun' as const, workItemID: r.workItemID },
    ])
    .with({ role: 'reviewer' }, (r) => [
      { command: 'cancelReviewerRun' as const, workItemID: r.workItemID },
    ])
    .exhaustive();
}
