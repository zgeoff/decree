import type { AgentRole, EngineCommand, EngineEvent } from '../state-store/domain-type-stubs.ts';
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
  const log = deps.logger.child({ component: 'commandExecutor' });
  const agentHandles = new Map<string, AgentRunHandle>();

  return {
    execute: async (command: EngineCommand, state: EngineState): Promise<EngineEvent[]> => {
      log.info({ commandType: command.command }, 'command executing');

      const guardResult = checkConcurrencyGuards(command, state);
      if (!guardResult.allowed) {
        log.warn({ commandType: command.command, reason: guardResult.reason }, 'guard rejected');
        return [{ type: 'commandRejected', command, reason: guardResult.reason ?? '' }];
      }

      const policyResult = deps.policy(command, state);
      if (!policyResult.allowed) {
        log.warn({ commandType: command.command, reason: policyResult.reason }, 'policy rejected');
        return [{ type: 'commandRejected', command, reason: policyResult.reason ?? '' }];
      }

      try {
        const resultEvents = await translateAndExecute(command, state, deps, boundStartAgentAsync);
        log.info(
          { commandType: command.command, resultEventCount: resultEvents.length },
          'command completed',
        );
        return resultEvents;
      } catch (error: unknown) {
        log.error({ commandType: command.command, err: error }, 'command failed');
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: 'commandFailed', command, error: message }];
      }
    },
  };

  function boundStartAgentAsync(
    role: AgentRole,
    sessionID: string,
    params: AgentStartParams,
  ): void {
    startAgentAsync(role, sessionID, params, { deps, agentHandles, logger: log }).catch(() => {
      // errors are handled internally by startAgentAsync via enqueue
    });
  }
}
