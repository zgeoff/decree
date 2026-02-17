import type { EngineCommand, EngineEvent } from '../state-store/domain-type-stubs.ts';
import type { EngineState } from '../state-store/types.ts';
import { checkConcurrencyGuards } from './check-concurrency-guards.ts';
import { startAgentAsync } from './start-agent-async.ts';
import { translateAndExecute } from './translate-and-execute.ts';
import type {
  AgentRunHandle,
  AgentStartParams,
  CommandExecutor,
  CommandExecutorDeps,
} from './types.ts';

export function createCommandExecutor(deps: CommandExecutorDeps): CommandExecutor {
  const agentHandles = new Map<string, AgentRunHandle>();

  return {
    execute: async (command: EngineCommand, state: EngineState): Promise<EngineEvent[]> => {
      const guardResult = checkConcurrencyGuards(command, state);
      if (!guardResult.allowed) {
        return [{ type: 'commandRejected', command, reason: guardResult.reason ?? '' }];
      }

      const policyResult = deps.policy(command, state);
      if (!policyResult.allowed) {
        return [{ type: 'commandRejected', command, reason: policyResult.reason ?? '' }];
      }

      try {
        return await translateAndExecute(command, state, deps, boundStartAgentAsync);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: 'commandFailed', command, error: message }];
      }
    },
  };

  function boundStartAgentAsync(
    role: Parameters<typeof startAgentAsync>[0],
    sessionID: string,
    params: AgentStartParams,
  ): void {
    startAgentAsync(role, sessionID, params, { deps, agentHandles }).catch(() => {
      // errors are handled internally by startAgentAsync via enqueue
    });
  }
}
