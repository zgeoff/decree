import type { CommandFailed } from '../engine/state-store/types.ts';
import { buildEngineCommand } from './build-engine-command.ts';

export function buildCommandFailedEvent(overrides?: Partial<CommandFailed>): CommandFailed {
  return {
    type: 'commandFailed',
    command: buildEngineCommand(),
    error: 'Provider call failed',
    ...overrides,
  };
}
