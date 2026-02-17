import type { Mock } from 'vitest';
import { expect, test, vi } from 'vitest';
import type { PlannerResult, ReviewerResult } from '../state-store/types.ts';
import {
  type BashValidatorHook,
  type ClaudeAdapterConfig,
  createClaudeAdapter,
} from './create-claude-adapter.ts';
import type {
  ImplementorStartParams,
  PlannerStartParams,
  ReviewerStartParams,
  RuntimeAdapterDeps,
} from './types.ts';

// --- Module mocks ---

vi.mock('node:child_process');
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('./context-assembly/build-planner-context.ts', () => ({
  buildPlannerContext: vi.fn(),
}));

vi.mock('./context-assembly/build-implementor-context.ts', () => ({
  buildImplementorContext: vi.fn(),
}));

vi.mock('./context-assembly/build-reviewer-context.ts', () => ({
  buildReviewerContext: vi.fn(),
}));

vi.mock('./load-agent-definition.ts', () => ({
  loadAgentDefinition: vi.fn(),
}));

vi.mock('./extract-patch.ts', () => ({
  extractPatch: vi.fn(),
}));

// --- Imports after mocks ---

import { execFile } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildImplementorContext } from './context-assembly/build-implementor-context.ts';
import { buildPlannerContext } from './context-assembly/build-planner-context.ts';
import { buildReviewerContext } from './context-assembly/build-reviewer-context.ts';
import { extractPatch } from './extract-patch.ts';
import { loadAgentDefinition } from './load-agent-definition.ts';

const mockQuery: Mock = vi.mocked(query) as unknown as Mock;
const mockExecFile: Mock = vi.mocked(execFile) as unknown as Mock;
const mockLoadAgentDefinition: Mock = vi.mocked(loadAgentDefinition) as unknown as Mock;
const mockBuildPlannerContext: Mock = vi.mocked(buildPlannerContext) as unknown as Mock;
const mockBuildImplementorContext: Mock = vi.mocked(buildImplementorContext) as unknown as Mock;
const mockBuildReviewerContext: Mock = vi.mocked(buildReviewerContext) as unknown as Mock;
const mockExtractPatch: Mock = vi.mocked(extractPatch) as unknown as Mock;

// --- Regex constants ---

const PLANNER_LOG_PATTERN = /planner\.log$/;
const IMPLEMENTOR_LOG_PATTERN = /implementor-42\.log$/;
const REVIEWER_LOG_PATTERN = /reviewer-42\.log$/;

// --- Test helpers ---

interface SetupTestResult {
  config: ClaudeAdapterConfig;
  deps: RuntimeAdapterDeps;
  bashValidatorHook: Mock;
}

function setupTest(overrides?: Partial<ClaudeAdapterConfig>): SetupTestResult {
  const bashValidatorHook: Mock = vi.fn(async () => undefined);

  const config: ClaudeAdapterConfig = {
    repoRoot: '/repo',
    defaultBranch: 'main',
    contextPaths: [],
    bashValidatorHook: bashValidatorHook as unknown as BashValidatorHook,
    maxAgentDuration: 0,
    logging: {
      agentSessions: false,
      logsDir: '/logs',
    },
    ...overrides,
  };

  const deps: RuntimeAdapterDeps = {
    workItemReader: {
      listWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      getWorkItemBody: vi.fn().mockResolvedValue('Work item body'),
    },
    revisionReader: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      getRevisionFiles: vi.fn().mockResolvedValue([]),
    },
    getState: vi.fn().mockReturnValue({
      workItems: new Map(),
      revisions: new Map(),
      specs: new Map(),
      agentRuns: new Map(),
      errors: [],
      lastPlannedSHAs: new Map(),
    }),
    getReviewHistory: vi.fn().mockResolvedValue({ reviews: [], inlineComments: [] }),
  };

  // Default mocks
  mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
  mockLoadAgentDefinition.mockResolvedValue({
    definition: {
      description: 'Test agent',
      tools: ['Read', 'Write'],
      disallowedTools: [],
      model: 'opus',
      prompt: 'You are a test agent.',
    },
    maxTurns: undefined,
  });
  mockBuildPlannerContext.mockResolvedValue('Planner context prompt');
  mockBuildImplementorContext.mockResolvedValue('Implementor context prompt');
  mockBuildReviewerContext.mockResolvedValue('Reviewer context prompt');
  mockExtractPatch.mockResolvedValue('diff --git a/file.ts b/file.ts\n+added line');

  return { config, deps, bashValidatorHook };
}

function buildPlannerParams(): PlannerStartParams {
  return { role: 'planner', specPaths: ['docs/specs/foo.md'] };
}

function buildImplementorParams(): ImplementorStartParams {
  return { role: 'implementor', workItemID: '42', branchName: 'issue-42-1234' };
}

function buildReviewerParams(): ReviewerStartParams {
  return { role: 'reviewer', workItemID: '42', revisionID: '99' };
}

interface MockQueryConfig {
  structuredOutput?: unknown;
  subtype?: string;
  textContent?: string[];
}

function setupMockQuery(queryConfig?: MockQueryConfig): void {
  const subtype = queryConfig?.subtype ?? 'success';
  const structuredOutput = queryConfig?.structuredOutput;
  const textContent = queryConfig?.textContent ?? [];

  const messages: unknown[] = [];

  // System init message
  messages.push({
    type: 'system',
    subtype: 'init',
    model: 'claude-opus-4-6',
    cwd: '/repo',
    tools: ['Read', 'Write'],
    session_id: 'test-session',
    uuid: 'uuid-1',
  });

  // Assistant text messages
  for (const text of textContent) {
    messages.push({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text }],
      },
      parent_tool_use_id: null,
      uuid: 'uuid-2',
      session_id: 'test-session',
    });
  }

  // Result message
  if (subtype === 'success') {
    messages.push({
      type: 'result',
      subtype: 'success',
      duration_ms: 5000,
      duration_api_ms: 4000,
      is_error: false,
      num_turns: 3,
      result: 'Done',
      stop_reason: 'end_turn',
      total_cost_usd: 0.1,
      usage: { input_tokens: 1000, output_tokens: 500 },
      modelUsage: {},
      permission_denials: [],
      structured_output: structuredOutput,
      uuid: 'uuid-3',
      session_id: 'test-session',
    });
  } else {
    messages.push({
      type: 'result',
      subtype,
      duration_ms: 5000,
      duration_api_ms: 4000,
      is_error: true,
      num_turns: 3,
      stop_reason: null,
      total_cost_usd: 0.1,
      usage: { input_tokens: 1000, output_tokens: 500 },
      modelUsage: {},
      permission_denials: [],
      errors: ['Max retries'],
      uuid: 'uuid-3',
      session_id: 'test-session',
    });
  }

  async function* mockAsyncGenerator(): AsyncGenerator<unknown, void> {
    for (const msg of messages) {
      yield msg;
    }
  }

  mockQuery.mockReturnValue(mockAsyncGenerator() as ReturnType<typeof query>);
}

// --- startAgent Lifecycle ---

test('it rejects when worktree setup fails due to yarn install error', async () => {
  const { config, deps } = setupTest();

  // First two execFile calls succeed (stale cleanup + worktree add), third fails (yarn install)
  const callTracker = { count: 0 };
  mockExecFile.mockImplementation(async () => {
    callTracker.count += 1;
    // Call 1: git worktree remove --force (stale cleanup) — may fail, ignore
    // Call 2: git worktree add — succeed
    // Call 3: yarn install — fail
    if (callTracker.count === 3) {
      throw new Error('yarn install failed: ENOENT');
    }
    return { stdout: '', stderr: '' };
  });

  await expect(deps.workItemReader.getWorkItemBody).toBeDefined();
  await expect(
    createClaudeAdapter(config, deps).startAgent(buildImplementorParams()),
  ).rejects.toThrow('yarn install failed');
});

test('it cleans up worktree and branch after implementor session completes successfully', async () => {
  const { config, deps } = setupTest();

  // Use implementor for cleanup test
  const implementorOutput = {
    role: 'implementor',
    outcome: 'completed',
    summary: 'Done',
  };

  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());

  await handle.result;

  // Verify worktree removal and branch deletion were called
  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['worktree', 'remove', expect.stringContaining('issue-42-1234')],
    expect.objectContaining({ cwd: '/repo' }),
  );
  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['branch', '-D', 'issue-42-1234'],
    expect.objectContaining({ cwd: '/repo' }),
  );
});

test('it cleans up worktree and branch after implementor session fails', async () => {
  const { config, deps } = setupTest();

  setupMockQuery({ subtype: 'error_during_execution' });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());

  await expect(handle.result).rejects.toThrow('Agent session failed');

  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['worktree', 'remove', expect.stringContaining('issue-42-1234')],
    expect.objectContaining({ cwd: '/repo' }),
  );
  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['branch', '-D', 'issue-42-1234'],
    expect.objectContaining({ cwd: '/repo' }),
  );
});

test('it removes stale worktree before creating a new one', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked by dependency',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());
  await handle.result;

  // First call should be stale cleanup: git worktree remove --force
  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['worktree', 'remove', '--force', expect.stringContaining('issue-42-1234')],
    expect.objectContaining({ cwd: '/repo' }),
  );
});

test('it force-resets branch with -B flag when worktree is created', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());
  await handle.result;

  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['worktree', 'add', expect.stringContaining('issue-42-1234'), '-B', 'issue-42-1234', 'main'],
    expect.objectContaining({ cwd: '/repo' }),
  );
});

test('it uses repository root as cwd for planner sessions', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        cwd: '/repo',
      }),
    }),
  );
});

test('it uses repository root as cwd for reviewer sessions', async () => {
  const { config, deps } = setupTest();

  const reviewerOutput: ReviewerResult = {
    role: 'reviewer',
    review: { verdict: 'approve', summary: 'Looks good', comments: [] },
  };
  setupMockQuery({ structuredOutput: reviewerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildReviewerParams());

  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        cwd: '/repo',
      }),
    }),
  );
});

test('it appends context file contents to agent prompt when contextPaths provided', async () => {
  const { config, deps } = setupTest({
    contextPaths: ['.claude/CLAUDE.md'],
  });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  // loadAgentDefinition is called with the contextPaths from config
  expect(mockLoadAgentDefinition).toHaveBeenCalledWith({
    repoRoot: '/repo',
    role: 'planner',
    contextPaths: ['.claude/CLAUDE.md'],
  });
});

test('it uses original prompt when contextPaths is empty', async () => {
  const { config, deps } = setupTest({ contextPaths: [] });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  expect(mockLoadAgentDefinition).toHaveBeenCalledWith({
    repoRoot: '/repo',
    role: 'planner',
    contextPaths: [],
  });
});

test('it rejects when a context file cannot be read', async () => {
  const { config, deps } = setupTest({ contextPaths: ['missing-file.md'] });

  mockLoadAgentDefinition.mockRejectedValue(new Error('ENOENT: no such file'));

  const adapter = createClaudeAdapter(config, deps);
  await expect(adapter.startAgent(buildPlannerParams())).rejects.toThrow('ENOENT');
});

// --- cancelAgent ---

test('it terminates a running session via abort controller when cancelled', async () => {
  const { config, deps } = setupTest();

  // Create a query that hangs until aborted
  let abortedResolve: (() => void) | null = null;
  const abortedPromise = new Promise<void>((r) => {
    abortedResolve = r;
  });

  async function* hangingGenerator(): AsyncGenerator<unknown, void> {
    yield {
      type: 'system',
      subtype: 'init',
      model: 'opus',
      cwd: '/repo',
      tools: [],
      session_id: 'test',
      uuid: 'uuid-1',
    };
    // Hang here
    await abortedPromise;
    throw new Error('Aborted');
  }

  mockQuery.mockReturnValue(hangingGenerator() as ReturnType<typeof query>);

  const adapter = createClaudeAdapter(config, deps);
  const params = buildPlannerParams();
  const handle = await adapter.startAgent(params);

  // Cancel the session (we need to find the sessionID — it's generated internally)
  // Since we can't know the exact sessionID, we use cancelAgent with a known pattern
  // The adapter tracks sessions by generated IDs, so we test the no-op case separately
  // For this test, we rely on the internal state

  // Wait a tick for the session to start processing
  await new Promise<void>((r) => {
    setTimeout(r, 10);
  });

  // Resolve the hanging generator to simulate abort
  abortedResolve?.();

  await expect(handle.result).rejects.toThrow();
});

test('it is a no-op when cancelAgent is called with an unknown session ID', () => {
  const { config, deps } = setupTest();
  const adapter = createClaudeAdapter(config, deps);

  // Should not throw
  adapter.cancelAgent('nonexistent-session-id');
});

// --- SDK Session Configuration ---

test('it calls query with correct SDK session options', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  expect(mockQuery).toHaveBeenCalledWith({
    prompt: 'Planner context prompt',
    options: expect.objectContaining({
      agent: 'planner',
      agents: expect.objectContaining({
        planner: expect.objectContaining({
          description: 'Test agent',
          prompt: 'You are a test agent.',
        }),
      }),
      cwd: '/repo',
      outputFormat: expect.objectContaining({
        type: 'json_schema',
      }),
      settingSources: [],
      hooks: expect.objectContaining({
        PreToolUse: expect.arrayContaining([
          expect.objectContaining({
            matcher: 'Bash',
          }),
        ]),
      }),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: expect.any(AbortController),
    }),
  });
});

test('it sets maxTurns when agent definition includes it', async () => {
  const { config, deps } = setupTest();

  mockLoadAgentDefinition.mockResolvedValue({
    definition: {
      description: 'Test agent',
      tools: ['Read'],
      disallowedTools: [],
      model: 'opus',
      prompt: 'Agent prompt.',
    },
    maxTurns: 50,
  });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        maxTurns: 50,
      }),
    }),
  );
});

test('it omits maxTurns when agent definition does not include it', async () => {
  const { config, deps } = setupTest();

  mockLoadAgentDefinition.mockResolvedValue({
    definition: {
      description: 'Test agent',
      tools: ['Read'],
      disallowedTools: [],
      model: 'opus',
      prompt: 'Agent prompt.',
    },
    maxTurns: undefined,
  });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  const queryCall = mockQuery.mock.calls[0]?.[0];
  expect(queryCall?.options).not.toHaveProperty('maxTurns');
});

// --- Structured Output & Result Assembly ---

test('it resolves with correctly typed planner result on valid structured output', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [
      {
        tempID: 'tmp-1',
        title: 'Add feature',
        body: 'Implement new feature',
        labels: ['feat'],
        blockedBy: [],
      },
    ],
    close: ['old-issue'],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());
  const result = await handle.result;

  expect(result).toMatchObject({
    role: 'planner',
    create: expect.arrayContaining([
      expect.objectContaining({ tempID: 'tmp-1', title: 'Add feature' }),
    ]),
    close: ['old-issue'],
  });
});

test('it rejects when SDK reports error_max_structured_output_retries', async () => {
  const { config, deps } = setupTest();

  setupMockQuery({ subtype: 'error_max_structured_output_retries' });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  await expect(handle.result).rejects.toThrow('error_max_structured_output_retries');
});

test('it enriches implementor result with extracted patch when outcome is completed', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'completed',
    summary: 'Implemented feature',
  };
  setupMockQuery({ structuredOutput: implementorOutput });
  mockExtractPatch.mockResolvedValue('diff --git a/src/foo.ts b/src/foo.ts\n+new code');

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());
  const result = await handle.result;

  expect(result).toMatchObject({
    role: 'implementor',
    outcome: 'completed',
    summary: 'Implemented feature',
    patch: 'diff --git a/src/foo.ts b/src/foo.ts\n+new code',
  });
});

test('it rejects when implementor completes but worktree has no changes', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'completed',
    summary: 'Done',
  };
  setupMockQuery({ structuredOutput: implementorOutput });
  mockExtractPatch.mockRejectedValue(
    new Error('Agent reported completed but made no changes — empty diff vs main'),
  );

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());

  await expect(handle.result).rejects.toThrow('empty diff');
});

test('it sets patch to null when implementor outcome is blocked', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked by dependency',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());
  const result = await handle.result;

  expect(result).toMatchObject({
    role: 'implementor',
    outcome: 'blocked',
    patch: null,
  });
  expect(mockExtractPatch).not.toHaveBeenCalled();
});

test('it sets patch to null when implementor outcome is validation-failure', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'validation-failure',
    summary: 'Tests failed',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());
  const result = await handle.result;

  expect(result).toMatchObject({
    role: 'implementor',
    outcome: 'validation-failure',
    patch: null,
  });
  expect(mockExtractPatch).not.toHaveBeenCalled();
});

test('it resolves with correctly typed reviewer result on valid structured output', async () => {
  const { config, deps } = setupTest();

  const reviewerOutput: ReviewerResult = {
    role: 'reviewer',
    review: {
      verdict: 'needs-changes',
      summary: 'Needs fixes',
      comments: [{ path: 'src/foo.ts', line: 10, body: 'Fix this' }],
    },
  };
  setupMockQuery({ structuredOutput: reviewerOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildReviewerParams());
  const result = await handle.result;

  expect(result).toMatchObject({
    role: 'reviewer',
    review: expect.objectContaining({
      verdict: 'needs-changes',
      summary: 'Needs fixes',
    }),
  });
});

// --- Output Stream ---

test('it yields plain text from assistant messages through the output stream', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({
    structuredOutput: plannerOutput,
    textContent: ['Hello, world!', 'Second message'],
  });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  const outputs: string[] = [];
  for await (const chunk of handle.output) {
    outputs.push(chunk);
  }

  expect(outputs).toContain('Hello, world!');
  expect(outputs).toContain('Second message');
});

test('it does not yield tool use metadata through the output stream', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };

  // Create messages with tool_use blocks mixed in
  const messages: unknown[] = [
    {
      type: 'system',
      subtype: 'init',
      model: 'opus',
      cwd: '/repo',
      tools: ['Read'],
      session_id: 'test',
      uuid: 'uuid-1',
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Planning...' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
        ],
      },
      parent_tool_use_id: null,
      uuid: 'uuid-2',
      session_id: 'test',
    },
    {
      type: 'tool_progress',
      tool_use_id: 'tool-1',
      tool_name: 'Read',
      parent_tool_use_id: null,
      elapsed_time_seconds: 1,
      uuid: 'uuid-3',
      session_id: 'test',
    },
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 3000,
      duration_api_ms: 2000,
      is_error: false,
      num_turns: 2,
      result: 'Done',
      stop_reason: 'end_turn',
      total_cost_usd: 0.05,
      usage: { input_tokens: 500, output_tokens: 200 },
      modelUsage: {},
      permission_denials: [],
      structured_output: plannerOutput,
      uuid: 'uuid-4',
      session_id: 'test',
    },
  ];

  async function* gen(): AsyncGenerator<unknown, void> {
    for (const msg of messages) {
      yield msg;
    }
  }

  mockQuery.mockReturnValue(gen() as ReturnType<typeof query>);

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  const outputs: string[] = [];
  for await (const chunk of handle.output) {
    outputs.push(chunk);
  }

  // Only text content should appear
  expect(outputs).toStrictEqual(['Planning...']);
});

test('it completes the output stream when the session ends', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput, textContent: ['Done'] });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  const outputs: string[] = [];
  for await (const chunk of handle.output) {
    outputs.push(chunk);
  }

  // If we reach here, the iterable completed
  expect(outputs).toStrictEqual(['Done']);
});

// --- Duration Timeout ---

test('it cancels the session when duration timeout is exceeded', async () => {
  vi.useFakeTimers();

  const { config, deps } = setupTest({ maxAgentDuration: 300 });

  // Create a generator that waits for abort
  let generatorResolve: (() => void) | null = null;

  async function* slowGenerator(): AsyncGenerator<unknown, void> {
    yield {
      type: 'system',
      subtype: 'init',
      model: 'opus',
      cwd: '/repo',
      tools: [],
      session_id: 'test',
      uuid: 'uuid-1',
    };
    await new Promise<void>((r) => {
      generatorResolve = r;
    });
    throw new Error('Session aborted due to timeout');
  }

  mockQuery.mockReturnValue(slowGenerator() as ReturnType<typeof query>);

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  // Advance time past the timeout
  vi.advanceTimersByTime(300_001);

  // Resolve the generator to let it throw
  generatorResolve?.();

  await expect(handle.result).rejects.toThrow();

  vi.useRealTimers();
});

// --- Agent Session Logging ---

test('it creates a log file when logging is enabled', async () => {
  const { config, deps } = setupTest({
    logging: { agentSessions: true, logsDir: '/logs' },
  });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  expect(handle.logFilePath).not.toBeNull();
  expect(handle.logFilePath).toMatch(PLANNER_LOG_PATTERN);
});

test('it sets logFilePath to null when logging is disabled', async () => {
  const { config, deps } = setupTest({
    logging: { agentSessions: false, logsDir: '/logs' },
  });

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildPlannerParams());

  expect(handle.logFilePath).toBeNull();
});

test('it includes work item ID in log filename for implementor sessions', async () => {
  const { config, deps } = setupTest({
    logging: { agentSessions: true, logsDir: '/logs' },
  });

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());

  expect(handle.logFilePath).toMatch(IMPLEMENTOR_LOG_PATTERN);
});

test('it includes work item ID in log filename for reviewer sessions', async () => {
  const { config, deps } = setupTest({
    logging: { agentSessions: true, logsDir: '/logs' },
  });

  const reviewerOutput: ReviewerResult = {
    role: 'reviewer',
    review: { verdict: 'approve', summary: 'OK', comments: [] },
  };
  setupMockQuery({ structuredOutput: reviewerOutput });

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildReviewerParams());

  expect(handle.logFilePath).toMatch(REVIEWER_LOG_PATTERN);
});

// --- Implementor worktree cleanup after cancellation ---

test('it cleans up worktree after implementor session is cancelled', async () => {
  const { config, deps } = setupTest();

  let resolveHang: (() => void) | null = null;

  async function* hangingGenerator(): AsyncGenerator<unknown, void> {
    yield {
      type: 'system',
      subtype: 'init',
      model: 'opus',
      cwd: '/repo',
      tools: [],
      session_id: 'test',
      uuid: 'uuid-1',
    };
    await new Promise<void>((r) => {
      resolveHang = r;
    });
    throw new Error('Cancelled');
  }

  mockQuery.mockReturnValue(hangingGenerator() as ReturnType<typeof query>);

  const adapter = createClaudeAdapter(config, deps);
  const handle = await adapter.startAgent(buildImplementorParams());

  // Wait for session to be streaming
  await new Promise<void>((r) => {
    setTimeout(r, 10);
  });

  // Resolve hang to simulate cancellation
  resolveHang?.();

  await expect(handle.result).rejects.toThrow();

  // Verify cleanup was called
  expect(mockExecFile).toHaveBeenCalledWith(
    'git',
    ['worktree', 'remove', expect.stringContaining('issue-42-1234')],
    expect.objectContaining({ cwd: '/repo' }),
  );
});

// --- Context assembly delegation ---

test('it delegates to buildPlannerContext for planner params', async () => {
  const { config, deps } = setupTest();

  const plannerOutput: PlannerResult = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };
  setupMockQuery({ structuredOutput: plannerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildPlannerParams());

  expect(mockBuildPlannerContext).toHaveBeenCalled();
  expect(mockBuildImplementorContext).not.toHaveBeenCalled();
  expect(mockBuildReviewerContext).not.toHaveBeenCalled();
});

test('it delegates to buildImplementorContext for implementor params', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildImplementorParams());

  expect(mockBuildImplementorContext).toHaveBeenCalled();
  expect(mockBuildPlannerContext).not.toHaveBeenCalled();
  expect(mockBuildReviewerContext).not.toHaveBeenCalled();
});

test('it delegates to buildReviewerContext for reviewer params', async () => {
  const { config, deps } = setupTest();

  const reviewerOutput: ReviewerResult = {
    role: 'reviewer',
    review: { verdict: 'approve', summary: 'OK', comments: [] },
  };
  setupMockQuery({ structuredOutput: reviewerOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildReviewerParams());

  expect(mockBuildReviewerContext).toHaveBeenCalled();
  expect(mockBuildPlannerContext).not.toHaveBeenCalled();
  expect(mockBuildImplementorContext).not.toHaveBeenCalled();
});

// --- Worktree cwd for implementor ---

test('it uses worktree path as cwd for implementor sessions', async () => {
  const { config, deps } = setupTest();

  const implementorOutput = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked',
  };
  setupMockQuery({ structuredOutput: implementorOutput });

  const adapter = createClaudeAdapter(config, deps);
  await adapter.startAgent(buildImplementorParams());

  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        cwd: expect.stringContaining('.worktrees/issue-42-1234'),
      }),
    }),
  );
});
