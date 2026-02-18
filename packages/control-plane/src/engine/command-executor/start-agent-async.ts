import { match } from 'ts-pattern';
import type { AgentResult, AgentRole, EngineEvent } from '../state-store/domain-type-stubs.ts';
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
      context.deps.enqueue(buildFailedEvent(sessionID, params, message, handle.logFilePath));
    } finally {
      context.agentHandles.delete(sessionID);
      context.deps.onHandleRemoved?.(sessionID);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    context.deps.enqueue(buildFailedEvent(sessionID, params, message, null));
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
  return match({ params, result })
    .with({ params: { role: 'planner' }, result: { role: 'planner' } }, (m) => ({
      type: 'plannerCompleted' as const,
      sessionID,
      specPaths: m.params.specPaths,
      result: m.result,
      logFilePath,
    }))
    .with({ params: { role: 'implementor' }, result: { role: 'implementor' } }, (m) => ({
      type: 'implementorCompleted' as const,
      sessionID,
      workItemID: m.params.workItemID,
      branchName: m.params.branchName,
      result: m.result,
      logFilePath,
    }))
    .with({ params: { role: 'reviewer' }, result: { role: 'reviewer' } }, (m) => ({
      type: 'reviewerCompleted' as const,
      sessionID,
      workItemID: m.params.workItemID,
      revisionID: m.params.revisionID,
      result: m.result,
      logFilePath,
    }))
    .otherwise(() => ({
      type: 'commandFailed' as const,
      command: { command: 'requestPlannerRun' as const, specPaths: [] },
      error: `unexpected role mismatch: params.role=${params.role} result.role=${result.role}`,
    }));
}

function buildFailedEvent(
  sessionID: string,
  params: AgentStartParams,
  error: string,
  logFilePath: string | null,
): EngineEvent {
  return match(params)
    .with({ role: 'planner' }, (p) => ({
      type: 'plannerFailed' as const,
      sessionID,
      specPaths: p.specPaths,
      error,
      logFilePath,
    }))
    .with({ role: 'implementor' }, (p) => ({
      type: 'implementorFailed' as const,
      sessionID,
      workItemID: p.workItemID,
      branchName: p.branchName,
      error,
      logFilePath,
    }))
    .with({ role: 'reviewer' }, (p) => ({
      type: 'reviewerFailed' as const,
      sessionID,
      workItemID: p.workItemID,
      revisionID: p.revisionID,
      error,
      logFilePath,
    }))
    .exhaustive();
}
