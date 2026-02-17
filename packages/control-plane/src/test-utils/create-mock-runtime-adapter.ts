import { vi } from 'vitest';
import type { AgentRunHandle, RuntimeAdapter } from '../engine/runtime-adapter/types.ts';
import type { AgentResult } from '../engine/state-store/domain-type-stubs.ts';

export interface ControllableHandle {
  handle: AgentRunHandle;
  resolveResult: (result: AgentResult) => void;
  rejectResult: (error: Error) => void;
}

export interface MockRuntimeAdapterConfig {
  startAgentError?: Error;
}

export interface MockRuntimeAdapterResult {
  adapter: RuntimeAdapter;
  handles: ControllableHandle[];
}

export function createMockRuntimeAdapter(
  config?: MockRuntimeAdapterConfig,
): MockRuntimeAdapterResult {
  const handles: ControllableHandle[] = [];

  const startAgent = config?.startAgentError
    ? vi.fn().mockRejectedValue(config.startAgentError)
    : vi.fn().mockImplementation(() => {
        const controllable = buildControllableHandle();
        handles.push(controllable);
        return Promise.resolve(controllable.handle);
      });

  const adapter: RuntimeAdapter = {
    startAgent,
    cancelAgent: vi.fn(),
  };

  return { adapter, handles };
}

function buildControllableHandle(): ControllableHandle {
  let resolveResult: (result: AgentResult) => void = () => {
    // placeholder — reassigned by Promise constructor below
  };
  let rejectResult: (error: Error) => void = () => {
    // placeholder — reassigned by Promise constructor below
  };

  const resultPromise = new Promise<AgentResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const handle: AgentRunHandle = {
    output: emptyAsyncIterable(),
    result: resultPromise,
    logFilePath: '/logs/agent.log',
  };

  return { handle, resolveResult, rejectResult };
}

async function* emptyAsyncIterable(): AsyncIterable<string> {
  // intentionally empty — tests control output via other means
}
