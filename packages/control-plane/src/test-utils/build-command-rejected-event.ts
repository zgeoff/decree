import type { CommandRejected } from '../engine/state-store/types.ts';
import { buildEngineCommand } from './build-engine-command.ts';

export function buildCommandRejectedEvent(overrides?: Partial<CommandRejected>): CommandRejected {
  return {
    type: 'commandRejected',
    command: buildEngineCommand(),
    reason: 'Concurrency guard: planner already running',
    ...overrides,
  };
}
