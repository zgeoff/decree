import type { CreateWorkItem, EngineCommand } from '../engine/state-store/types.ts';

export function buildEngineCommand(overrides?: Partial<CreateWorkItem>): EngineCommand {
  return {
    command: 'createWorkItem',
    title: 'Test work item',
    body: 'Test body',
    labels: [],
    blockedBy: [],
    ...overrides,
  };
}
