import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type {
  AgentResult,
  AgentRole,
  EngineEvent,
  FailureReason,
} from '../state-store/domain-type-stubs.ts';
import type { AgentRunHandle, AgentStartParams, CommandExecutorDeps } from './types.ts';

interface StartAgentContext {
  deps: CommandExecutorDeps;
  agentHandles: Map<string, AgentRunHandle>;
}

export async function startAgentAsync(
  role: AgentRole,
  sessionID: string,
  params: AgentStartParams,
  context: StartAgentContext,
): Promise<void> {
  try {
    const handle = await context.deps.runtimeAdapters[role].startAgent(params);
    context.agentHandles.set(sessionID, handle);
    context.deps.onHandleRegistered?.(sessionID, handle);
    context.deps.enqueue(buildStartedEvent(role, sessionID, handle.logFilePath));

    try {
      const result = await handle.result;
      context.deps.enqueue(buildCompletedEvent(sessionID, params, result, handle.logFilePath));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = deriveFailureReason(handle.abortSignal);
      context.deps.enqueue(
        buildFailedEvent({
          sessionID,
          params,
          reason,
          error: message,
          logFilePath: handle.logFilePath,
        }),
      );
    } finally {
      context.agentHandles.delete(sessionID);
      context.deps.onHandleRemoved?.(sessionID);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    context.deps.enqueue(
      buildFailedEvent({ sessionID, params, reason: 'error', error: message, logFilePath: null }),
    );
  }
}

function buildStartedEvent(
  role: AgentRole,
  sessionID: string,
  logFilePath: string | null,
): EngineEvent {
  return match(role)
    .with('planner', () => ({
      type: 'plannerStarted' as const,
      sessionID,
      logFilePath,
    }))
    .with('implementor', () => ({
      type: 'implementorStarted' as const,
      sessionID,
      logFilePath,
    }))
    .with('reviewer', () => ({
      type: 'reviewerStarted' as const,
      sessionID,
      logFilePath,
    }))
    .exhaustive();
}

function buildCompletedEvent(
  sessionID: string,
  params: AgentStartParams,
  result: AgentResult,
  logFilePath: string | null,
): EngineEvent {
  return match(result)
    .with({ role: 'planner' }, (r) => {
      invariant(params.role === 'planner', `expected planner params, got ${params.role}`);
      return {
        type: 'plannerCompleted' as const,
        sessionID,
        specPaths: params.specPaths,
        result: r,
        logFilePath,
      };
    })
    .with({ role: 'implementor' }, (r) => {
      invariant(params.role === 'implementor', `expected implementor params, got ${params.role}`);
      return {
        type: 'implementorCompleted' as const,
        sessionID,
        workItemID: params.workItemID,
        branchName: params.branchName,
        result: r,
        logFilePath,
      };
    })
    .with({ role: 'reviewer' }, (r) => {
      invariant(params.role === 'reviewer', `expected reviewer params, got ${params.role}`);
      return {
        type: 'reviewerCompleted' as const,
        sessionID,
        workItemID: params.workItemID,
        revisionID: params.revisionID,
        result: r,
        logFilePath,
      };
    })
    .exhaustive();
}

interface FailedEventInput {
  sessionID: string;
  params: AgentStartParams;
  reason: FailureReason;
  error: string;
  logFilePath: string | null;
}

function buildFailedEvent(input: FailedEventInput): EngineEvent {
  const { sessionID, params, reason, error, logFilePath } = input;
  return match(params)
    .with({ role: 'planner' }, (p) => ({
      type: 'plannerFailed' as const,
      sessionID,
      specPaths: p.specPaths,
      reason,
      error,
      logFilePath,
    }))
    .with({ role: 'implementor' }, (p) => ({
      type: 'implementorFailed' as const,
      sessionID,
      workItemID: p.workItemID,
      branchName: p.branchName,
      reason,
      error,
      logFilePath,
    }))
    .with({ role: 'reviewer' }, (p) => ({
      type: 'reviewerFailed' as const,
      sessionID,
      workItemID: p.workItemID,
      revisionID: p.revisionID,
      reason,
      error,
      logFilePath,
    }))
    .exhaustive();
}

const ABORT_REASON_TO_FAILURE: Record<string, FailureReason> = {
  timeout: 'timeout',
  cancelled: 'cancelled',
};

function deriveFailureReason(abortSignal: AbortSignal | undefined): FailureReason {
  if (abortSignal === undefined || !abortSignal.aborted) {
    return 'error';
  }
  return ABORT_REASON_TO_FAILURE[abortSignal.reason] ?? 'error';
}
