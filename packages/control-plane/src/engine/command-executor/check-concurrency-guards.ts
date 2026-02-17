import { match } from 'ts-pattern';
import type { EngineCommand } from '../state-store/domain-type-stubs.ts';
import { getActivePlannerRun } from '../state-store/selectors/get-active-planner-run.ts';
import { isAgentRunningForWorkItem } from '../state-store/selectors/is-agent-running-for-work-item.ts';
import type { EngineState } from '../state-store/types.ts';
import type { GuardResult } from './types.ts';

const ALLOWED: GuardResult = { allowed: true, reason: null };

export function checkConcurrencyGuards(command: EngineCommand, state: EngineState): GuardResult {
  return match(command)
    .with({ command: 'requestPlannerRun' }, () => {
      if (getActivePlannerRun(state) !== null) {
        return { allowed: false, reason: 'planner already running' };
      }
      return ALLOWED;
    })
    .with({ command: 'requestImplementorRun' }, (cmd) => {
      if (isAgentRunningForWorkItem(state, cmd.workItemID)) {
        return { allowed: false, reason: 'agent already running for work item' };
      }
      return ALLOWED;
    })
    .with({ command: 'requestReviewerRun' }, (cmd) => {
      if (isAgentRunningForWorkItem(state, cmd.workItemID)) {
        return { allowed: false, reason: 'agent already running for work item' };
      }
      return ALLOWED;
    })
    .otherwise(() => ALLOWED);
}
