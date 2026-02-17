import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type {
  AgentRole,
  EngineCommand,
  EngineEvent,
  ImplementorResult,
  PlannerResult,
  ReviewerResult,
  Revision,
  RevisionChanged,
  WorkItem,
  WorkItemChanged,
  WorkItemStatus,
} from '../state-store/domain-type-stubs.ts';
import { getActiveAgentRun } from '../state-store/selectors/get-active-agent-run.ts';
import { getActivePlannerRun } from '../state-store/selectors/get-active-planner-run.ts';
import { getWorkItemWithRevision } from '../state-store/selectors/get-work-item-with-revision.ts';
import type { EngineState } from '../state-store/types.ts';
import { buildBranchName } from './build-branch-name.ts';
import type { AgentStartParams, CommandExecutorDeps } from './types.ts';

export async function translateAndExecute(
  command: EngineCommand,
  state: EngineState,
  deps: CommandExecutorDeps,
  startAgentAsync: (role: AgentRole, sessionID: string, params: AgentStartParams) => void,
): Promise<EngineEvent[]> {
  return match(command)
    .with({ command: 'transitionWorkItemStatus' }, async (cmd) => {
      const workItem = state.workItems.get(cmd.workItemID);
      invariant(workItem, `work item ${cmd.workItemID} not found in state`);
      await deps.workItemWriter.transitionStatus(cmd.workItemID, cmd.newStatus);
      return [buildWorkItemChangedFromExisting(workItem, cmd.newStatus)];
    })
    .with({ command: 'createWorkItem' }, async (cmd) => {
      const createdWorkItem = await deps.workItemWriter.createWorkItem(
        cmd.title,
        cmd.body,
        cmd.labels,
        cmd.blockedBy,
      );
      return [buildWorkItemChangedFromCreated(createdWorkItem)];
    })
    .with({ command: 'createRevisionFromPatch' }, async (cmd) => {
      const createdRevision = await deps.revisionWriter.createFromPatch(
        cmd.workItemID,
        cmd.patch,
        cmd.branchName,
      );
      return [buildRevisionChangedFromCreated(createdRevision, cmd.workItemID)];
    })
    .with({ command: 'updateWorkItem' }, async (cmd) => {
      await deps.workItemWriter.updateWorkItem(cmd.workItemID, cmd.body, cmd.labels);
      return [];
    })
    .with({ command: 'updateRevision' }, async (cmd) => {
      invariant(cmd.body !== null, 'updateRevision body must not be null');
      await deps.revisionWriter.updateBody(cmd.revisionID, cmd.body);
      return [];
    })
    .with({ command: 'postRevisionReview' }, async (cmd) => {
      await deps.revisionWriter.postReview(cmd.revisionID, cmd.review);
      return [];
    })
    .with({ command: 'commentOnRevision' }, async (cmd) => {
      await deps.revisionWriter.postComment(cmd.revisionID, cmd.body);
      return [];
    })
    .with({ command: 'updateRevisionReview' }, async (cmd) => {
      const revision = state.revisions.get(cmd.revisionID);
      invariant(revision, `revision ${cmd.revisionID} not found in state`);
      invariant(revision.reviewID !== null, `revision ${cmd.revisionID} has no reviewID`);
      await deps.revisionWriter.updateReview(cmd.revisionID, revision.reviewID, cmd.review);
      return [];
    })
    .with({ command: 'requestPlannerRun' }, (cmd) => {
      const sessionID = crypto.randomUUID();
      startAgentAsync('planner', sessionID, { role: 'planner', specPaths: cmd.specPaths });
      return [{ type: 'plannerRequested' as const, sessionID, specPaths: cmd.specPaths }];
    })
    .with({ command: 'requestImplementorRun' }, (cmd) => {
      const sessionID = crypto.randomUUID();
      const branchName = buildBranchName(cmd.workItemID);
      startAgentAsync('implementor', sessionID, {
        role: 'implementor',
        workItemID: cmd.workItemID,
        branchName,
      });
      return [
        {
          type: 'implementorRequested' as const,
          sessionID,
          workItemID: cmd.workItemID,
          branchName,
        },
      ];
    })
    .with({ command: 'requestReviewerRun' }, (cmd) => {
      const sessionID = crypto.randomUUID();
      startAgentAsync('reviewer', sessionID, {
        role: 'reviewer',
        workItemID: cmd.workItemID,
        revisionID: cmd.revisionID,
      });
      return [
        {
          type: 'reviewerRequested' as const,
          sessionID,
          workItemID: cmd.workItemID,
          revisionID: cmd.revisionID,
        },
      ];
    })
    .with({ command: 'cancelPlannerRun' }, () => {
      const activeRun = getActivePlannerRun(state);
      if (activeRun !== null) {
        deps.runtimeAdapters.planner.cancelAgent(activeRun.sessionID);
      }
      return [];
    })
    .with({ command: 'cancelImplementorRun' }, (cmd) => {
      const activeRun = getActiveAgentRun(state, cmd.workItemID);
      if (activeRun !== null) {
        deps.runtimeAdapters.implementor.cancelAgent(activeRun.sessionID);
      }
      return [];
    })
    .with({ command: 'cancelReviewerRun' }, (cmd) => {
      const activeRun = getActiveAgentRun(state, cmd.workItemID);
      if (activeRun !== null) {
        deps.runtimeAdapters.reviewer.cancelAgent(activeRun.sessionID);
      }
      return [];
    })
    .with({ command: 'applyPlannerResult' }, async (cmd) =>
      applyPlannerResult(cmd.result, state, deps),
    )
    .with({ command: 'applyImplementorResult' }, async (cmd) =>
      applyImplementorResult(cmd.workItemID, cmd.result, state, deps),
    )
    .with({ command: 'applyReviewerResult' }, async (cmd) => applyReviewerResult(cmd, state, deps))
    .exhaustive();
}

async function applyPlannerResult(
  result: PlannerResult,
  state: EngineState,
  deps: CommandExecutorDeps,
): Promise<EngineEvent[]> {
  const resultEvents: EngineEvent[] = [];
  const tempIDToRealID = new Map<string, string>();

  for (const entry of result.create) {
    const resolvedBlockedBy = entry.blockedBy.map((id) => tempIDToRealID.get(id) ?? id);
    // biome-ignore lint/performance/noAwaitInLoops: sequential creates required — later entries reference earlier entries' tempIDs
    const createdWorkItem = await deps.workItemWriter.createWorkItem(
      entry.title,
      entry.body,
      entry.labels,
      resolvedBlockedBy,
    );
    tempIDToRealID.set(entry.tempID, createdWorkItem.id);
    resultEvents.push(buildWorkItemChangedFromCreated(createdWorkItem));
  }

  for (const workItemID of result.close) {
    const workItem = state.workItems.get(workItemID);
    invariant(workItem, `work item ${workItemID} not found in state`);
    // biome-ignore lint/performance/noAwaitInLoops: sequential closes required — each produces an event in order
    await deps.workItemWriter.transitionStatus(workItemID, 'closed');
    resultEvents.push(buildWorkItemChangedFromExisting(workItem, 'closed'));
  }

  for (const entry of result.update) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential updates required — fire-and-forget operations processed in order
    await deps.workItemWriter.updateWorkItem(entry.workItemID, entry.body, entry.labels);
  }

  return resultEvents;
}

async function applyImplementorResult(
  workItemID: string,
  result: ImplementorResult,
  state: EngineState,
  deps: CommandExecutorDeps,
): Promise<EngineEvent[]> {
  return match(result)
    .with({ outcome: 'completed' }, async (r) => {
      const activeRun = getActiveAgentRun(state, workItemID);
      invariant(activeRun, `no active agent run for work item ${workItemID}`);
      invariant(activeRun.role === 'implementor', 'active run is not an implementor');
      const branchName = activeRun.branchName;
      invariant(r.patch !== null, 'implementor completed without a patch');
      const createdRevision = await deps.revisionWriter.createFromPatch(
        workItemID,
        r.patch,
        branchName,
      );
      const revisionEvent = buildRevisionChangedFromCreated(createdRevision, workItemID);
      await deps.workItemWriter.transitionStatus(workItemID, 'review');
      const workItem = state.workItems.get(workItemID);
      invariant(workItem, `work item ${workItemID} not found in state`);
      const workItemEvent = buildWorkItemChangedFromExisting(workItem, 'review');
      return [revisionEvent, workItemEvent];
    })
    .with({ outcome: 'blocked' }, async () => {
      await deps.workItemWriter.transitionStatus(workItemID, 'blocked');
      const workItem = state.workItems.get(workItemID);
      invariant(workItem, `work item ${workItemID} not found in state`);
      return [buildWorkItemChangedFromExisting(workItem, 'blocked')];
    })
    .with({ outcome: 'validation-failure' }, async () => {
      await deps.workItemWriter.transitionStatus(workItemID, 'needs-refinement');
      const workItem = state.workItems.get(workItemID);
      invariant(workItem, `work item ${workItemID} not found in state`);
      return [buildWorkItemChangedFromExisting(workItem, 'needs-refinement')];
    })
    .exhaustive();
}

async function applyReviewerResult(
  command: { workItemID: string; revisionID: string; result: ReviewerResult },
  state: EngineState,
  deps: CommandExecutorDeps,
): Promise<EngineEvent[]> {
  const pair = getWorkItemWithRevision(state, command.workItemID);
  invariant(pair, `work item ${command.workItemID} has no linked revision in state`);

  if (pair.revision.reviewID === null) {
    await deps.revisionWriter.postReview(command.revisionID, command.result.review);
  } else {
    await deps.revisionWriter.updateReview(
      command.revisionID,
      pair.revision.reviewID,
      command.result.review,
    );
  }

  const newStatus: WorkItemStatus = match(command.result.review.verdict)
    .with('approve', () => 'approved' as const)
    .with('needs-changes', () => 'needs-refinement' as const)
    .exhaustive();

  await deps.workItemWriter.transitionStatus(command.workItemID, newStatus);
  return [buildWorkItemChangedFromExisting(pair.workItem, newStatus)];
}

function buildWorkItemChangedFromExisting(
  workItem: WorkItem,
  newStatus: WorkItemStatus,
): WorkItemChanged {
  return {
    type: 'workItemChanged',
    workItemID: workItem.id,
    workItem: { ...workItem, status: newStatus },
    title: workItem.title,
    oldStatus: workItem.status,
    newStatus,
    priority: workItem.priority,
  };
}

function buildWorkItemChangedFromCreated(workItem: WorkItem): WorkItemChanged {
  return {
    type: 'workItemChanged',
    workItemID: workItem.id,
    workItem,
    title: workItem.title,
    oldStatus: null,
    newStatus: workItem.status,
    priority: workItem.priority,
  };
}

function buildRevisionChangedFromCreated(revision: Revision, workItemID: string): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: revision.id,
    workItemID,
    revision,
    oldPipelineStatus: null,
    newPipelineStatus: revision.pipeline?.status ?? null,
  };
}
