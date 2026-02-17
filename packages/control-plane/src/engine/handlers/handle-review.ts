import { match } from 'ts-pattern';
import type { EngineCommand, EngineEvent, EngineState } from '../state-store/types.ts';

export function handleReview(event: EngineEvent, state: EngineState): EngineCommand[] {
  return match(event)
    .with({ type: 'revisionChanged' }, (e) => {
      if (e.newPipelineStatus !== 'success') {
        return [];
      }
      if (e.workItemID === null) {
        return [];
      }
      const workItem = state.workItems.get(e.workItemID);
      if (!workItem || workItem.status !== 'review') {
        return [];
      }
      return [
        {
          command: 'requestReviewerRun' as const,
          workItemID: e.workItemID,
          revisionID: e.revisionID,
        },
      ];
    })
    .with({ type: 'reviewerCompleted' }, (e) => [
      {
        command: 'applyReviewerResult' as const,
        workItemID: e.workItemID,
        revisionID: e.revisionID,
        result: e.result,
      },
    ])
    .with({ type: 'reviewerFailed' }, (e) => [
      {
        command: 'transitionWorkItemStatus' as const,
        workItemID: e.workItemID,
        newStatus: 'pending' as const,
      },
    ])
    .otherwise(() => []);
}
