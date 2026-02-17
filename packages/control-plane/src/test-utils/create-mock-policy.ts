import { vi } from 'vitest';
import type { Policy, PolicyResult } from '../engine/command-executor/types.ts';

export interface MockPolicyConfig {
  rejectedCommands?: Map<string, string>;
}

const ALLOWED: PolicyResult = { allowed: true, reason: null };

export function createMockPolicy(config?: MockPolicyConfig): Policy {
  if (!config?.rejectedCommands) {
    return vi.fn().mockReturnValue(ALLOWED);
  }

  const rejectedCommands = config.rejectedCommands;
  return vi.fn().mockImplementation((command: { command: string }) => {
    const reason = rejectedCommands.get(command.command);
    if (reason !== undefined) {
      return { allowed: false, reason };
    }
    return ALLOWED;
  });
}
