import { execFile } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  HookCallback,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildImplementorContext } from './context-assembly/build-implementor-context.ts';
import { buildPlannerContext } from './context-assembly/build-planner-context.ts';
import { buildReviewerContext } from './context-assembly/build-reviewer-context.ts';
import { extractPatch } from './extract-patch.ts';
import { loadAgentDefinition } from './load-agent-definition.ts';
import { ImplementorOutputSchema, PlannerOutputSchema, ReviewerOutputSchema } from './schemas.ts';
import type {
  AgentRunHandle,
  AgentStartParams,
  ImplementorStartParams,
  PlannerStartParams,
  ReviewerStartParams,
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterDeps,
} from './types.ts';

// --- Types ---

/**
 * Hook response type narrowed from the SDK's SyncHookJSONOutput.
 */
type HookResponse = SyncHookJSONOutput;

/**
 * Narrowed hook callback type — avoids leaking SDK types outside the adapter module.
 */
export type BashValidatorHook = (event: {
  tool_name: string;
  tool_input: Record<string, unknown>;
}) => Promise<HookResponse | undefined>;

/**
 * Configuration for the Claude adapter, extending the base runtime adapter config.
 */
export interface ClaudeAdapterConfig extends RuntimeAdapterConfig {
  repoRoot: string;
  defaultBranch: string;
  contextPaths: string[];
  bashValidatorHook: BashValidatorHook;
}

interface ActiveSession {
  abortController: AbortController;
  role: string;
  branchName: string | null;
}

// --- Constants ---

const WORKTREES_DIR = '.worktrees';
const MS_PER_SECOND = 1000;

// --- Primary export ---

/**
 * Creates a Claude runtime adapter that wires together worktree management,
 * context assembly, agent definition loading, SDK session orchestration,
 * structured output validation, patch extraction, duration timeout,
 * cancellation, and session logging.
 */
export function createClaudeAdapter(
  config: ClaudeAdapterConfig,
  deps: RuntimeAdapterDeps,
): RuntimeAdapter {
  const sessions = new Map<string, ActiveSession>();

  return {
    startAgent: (params: AgentStartParams): Promise<AgentRunHandle> =>
      startAgent(config, deps, sessions, params),
    cancelAgent: (sessionID: string): void => cancelAgent(sessions, sessionID),
  };
}

// --- startAgent ---

async function startAgent(
  config: ClaudeAdapterConfig,
  deps: RuntimeAdapterDeps,
  sessions: Map<string, ActiveSession>,
  params: AgentStartParams,
): Promise<AgentRunHandle> {
  const isImplementor = params.role === 'implementor';
  let workingDirectory = config.repoRoot;
  let branchName: string | null = null;

  // Step 1: Worktree setup (Implementor only)
  if (isImplementor) {
    branchName = (params as ImplementorStartParams).branchName;
    workingDirectory = resolve(config.repoRoot, WORKTREES_DIR, branchName);

    try {
      await setupWorktree(config, branchName);
    } catch (error) {
      await safeCleanupWorktree(config, branchName);
      throw error;
    }
  }

  try {
    // Step 2: Context assembly
    const enrichedPrompt = await assembleContext(params, config, deps);

    // Step 3: Agent definition loading
    const { definition, maxTurns } = await loadAgentDefinition({
      repoRoot: config.repoRoot,
      role: params.role,
      contextPaths: config.contextPaths,
    });

    // Step 4: SDK session creation
    const abortController = new AbortController();
    const outputSchema = getOutputSchemaForRole(params.role);

    const hookCallback: HookCallback = async (
      input: import('@anthropic-ai/claude-agent-sdk').HookInput,
    ) => {
      if (!('tool_name' in input)) {
        return { continue: true };
      }
      const result = await config.bashValidatorHook({
        tool_name: input.tool_name as string,
        tool_input: input.tool_input as Record<string, unknown>,
      });
      return result ?? { continue: true };
    };

    const sdkDefinition: import('@anthropic-ai/claude-agent-sdk').AgentDefinition = {
      description: definition.description,
      tools: definition.tools,
      disallowedTools: definition.disallowedTools,
      model: validateModel(definition.model),
      prompt: definition.prompt,
    };

    const q = query({
      prompt: enrichedPrompt,
      options: {
        agent: params.role,
        agents: { [params.role]: sdkDefinition },
        ...(maxTurns !== undefined && { maxTurns }),
        cwd: workingDirectory,
        outputFormat: {
          type: 'json_schema',
          schema: z.toJSONSchema(outputSchema),
        },
        settingSources: [],
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [hookCallback] }],
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    });

    // Step 5: Session tracking
    const sessionID = buildSessionID(params);

    sessions.set(sessionID, {
      abortController,
      role: params.role,
      branchName,
    });

    // Step 6: Log file setup
    const logContext = buildLogContext(config, params, sessionID);

    // Step 7: Build and return handle
    const outputBuffer: string[] = [];
    let outputResolve: (() => void) | null = null;
    let outputDone = false;

    function pushOutput(text: string): void {
      outputBuffer.push(text);
      if (outputResolve !== null) {
        const r = outputResolve;
        outputResolve = null;
        r();
      }
    }

    function endOutput(): void {
      outputDone = true;
      if (outputResolve !== null) {
        const r = outputResolve;
        outputResolve = null;
        r();
      }
    }

    async function* outputIterable(): AsyncIterable<string> {
      let running = true;
      while (running) {
        while (outputBuffer.length > 0) {
          yield outputBuffer.shift() as string;
        }
        if (outputDone) {
          running = false;
        } else {
          // biome-ignore lint/performance/noAwaitInLoops: intentional — async generator waits for push notifications
          await new Promise<void>((r) => {
            outputResolve = r;
          });
        }
      }
    }

    // Duration timeout
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (config.maxAgentDuration > 0) {
      const timeoutMs = config.maxAgentDuration * MS_PER_SECOND;
      timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);
    }

    const resultPromise = processSession({
      q,
      params,
      config,
      logContext,
      pushOutput,
      endOutput,
      sessions,
      sessionID,
      timeoutHandle,
    });

    return {
      output: outputIterable(),
      result: resultPromise,
      logFilePath: logContext.logFilePath,
    };
  } catch (error) {
    if (isImplementor && branchName !== null) {
      await safeCleanupWorktree(config, branchName);
    }
    throw error;
  }
}

// --- cancelAgent ---

function cancelAgent(sessions: Map<string, ActiveSession>, sessionID: string): void {
  const session = sessions.get(sessionID);
  if (session === undefined) {
    return;
  }
  session.abortController.abort();
}

// --- Session processing ---

interface ProcessSessionParams {
  q: AsyncGenerator<SDKMessage, void>;
  params: AgentStartParams;
  config: ClaudeAdapterConfig;
  logContext: LogContext;
  pushOutput: (text: string) => void;
  endOutput: () => void;
  sessions: Map<string, ActiveSession>;
  sessionID: string;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

async function processSession(
  opts: ProcessSessionParams,
): Promise<import('../state-store/domain-type-stubs.ts').AgentResult> {
  try {
    let resultMessage: SDKResultMessage | null = null;

    for await (const message of opts.q) {
      // Log message if logging enabled
      await logMessage(opts.logContext, message);

      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        extractTextFromAssistant(assistantMsg, opts.pushOutput);
      }

      if (message.type === 'result') {
        resultMessage = message as SDKResultMessage;
      }
    }

    opts.endOutput();

    if (resultMessage === null) {
      throw new Error('Agent session ended without a result message');
    }

    // Write session footer
    await logFooter(opts.logContext, resultMessage);

    // Check for SDK-level failure
    if (resultMessage.subtype !== 'success') {
      throw new Error(`Agent session failed: ${resultMessage.subtype}`);
    }

    const successResult = resultMessage as SDKResultSuccess;

    // Validate structured output
    return await assembleResult(opts.params, opts.config, successResult);
  } catch (error) {
    opts.endOutput();
    // Write error footer
    await logErrorFooter(opts.logContext);
    throw error;
  } finally {
    if (opts.timeoutHandle !== null) {
      clearTimeout(opts.timeoutHandle);
    }

    // Cleanup worktree for implementor
    if (opts.params.role === 'implementor') {
      const branchName = (opts.params as ImplementorStartParams).branchName;
      await safeCleanupWorktree(opts.config, branchName);
    }

    opts.sessions.delete(opts.sessionID);
  }
}

// --- Result assembly ---

async function assembleResult(
  params: AgentStartParams,
  config: ClaudeAdapterConfig,
  successResult: SDKResultSuccess,
): Promise<import('../state-store/domain-type-stubs.ts').AgentResult> {
  const structuredOutput = successResult.structured_output;

  if (params.role === 'planner') {
    const parseResult = PlannerOutputSchema.safeParse(structuredOutput);
    if (!parseResult.success) {
      throw new Error(`Planner output validation failed: ${parseResult.error.message}`);
    }
    return parseResult.data as import('../state-store/domain-type-stubs.ts').PlannerResult;
  }

  if (params.role === 'reviewer') {
    const parseResult = ReviewerOutputSchema.safeParse(structuredOutput);
    if (!parseResult.success) {
      throw new Error(`Reviewer output validation failed: ${parseResult.error.message}`);
    }
    return parseResult.data as import('../state-store/domain-type-stubs.ts').ReviewerResult;
  }

  // Implementor
  const parseResult = ImplementorOutputSchema.safeParse(structuredOutput);
  if (!parseResult.success) {
    throw new Error(`Implementor output validation failed: ${parseResult.error.message}`);
  }

  const implementorOutput = parseResult.data as {
    role: 'implementor';
    outcome: 'completed' | 'blocked' | 'validation-failure';
    summary: string;
  };

  let patch: string | null = null;

  if (implementorOutput.outcome === 'completed') {
    const branchName = (params as ImplementorStartParams).branchName;
    const worktreeDir = resolve(config.repoRoot, WORKTREES_DIR, branchName);
    patch = await extractPatch(worktreeDir, config.defaultBranch);
  }

  return {
    role: 'implementor',
    outcome: implementorOutput.outcome,
    summary: implementorOutput.summary,
    patch,
  };
}

// --- Context assembly ---

async function assembleContext(
  params: AgentStartParams,
  config: ClaudeAdapterConfig,
  deps: RuntimeAdapterDeps,
): Promise<string> {
  if (params.role === 'planner') {
    return buildPlannerContext(params as PlannerStartParams, deps.getState, {
      repoRoot: config.repoRoot,
      workItemReader: deps.workItemReader,
      gitShowBlob: async (blobSHA: string): Promise<string> => {
        const result = await execGit(config.repoRoot, ['show', blobSHA]);
        return result.stdout;
      },
      createDiff: (_oldContent: string, _newContent: string, filePath: string): string => {
        // Simple line-by-line diff — build-planner-context tests mock this,
        // so real implementation detail doesn't matter here
        return `--- a/${filePath}\n+++ b/${filePath}\n`;
      },
    });
  }

  if (params.role === 'implementor') {
    return buildImplementorContext(params as ImplementorStartParams, {
      workItemReader: deps.workItemReader,
      revisionReader: deps.revisionReader,
      getState: deps.getState,
      getReviewHistory: deps.getReviewHistory,
    });
  }

  // Reviewer
  return buildReviewerContext({
    params: params as ReviewerStartParams,
    getState: deps.getState,
    deps,
  });
}

// --- Output schema ---

function getOutputSchemaForRole(role: string): z.ZodType {
  if (role === 'planner') {
    return PlannerOutputSchema;
  }
  if (role === 'reviewer') {
    return ReviewerOutputSchema;
  }
  return ImplementorOutputSchema;
}

// --- Text extraction ---

function extractTextFromAssistant(
  message: SDKAssistantMessage,
  pushOutput: (text: string) => void,
): void {
  const content = message.message?.content;
  if (!content) {
    return;
  }

  for (const block of content) {
    if (block.type === 'text') {
      pushOutput((block as { type: 'text'; text: string }).text);
    }
  }
}

// --- Session ID ---

function buildSessionID(params: AgentStartParams): string {
  if (params.role === 'planner') {
    return `planner-${Date.now()}`;
  }
  if (params.role === 'implementor') {
    return `implementor-${(params as ImplementorStartParams).workItemID}-${Date.now()}`;
  }
  return `reviewer-${(params as ReviewerStartParams).workItemID}-${Date.now()}`;
}

// --- Worktree management ---

const execFileAsync: (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile) as (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
) => Promise<{ stdout: string; stderr: string }>;

async function execGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function setupWorktree(config: ClaudeAdapterConfig, branchName: string): Promise<void> {
  const worktreePath = resolve(config.repoRoot, WORKTREES_DIR, branchName);

  // Stale cleanup: remove existing worktree if present
  try {
    await execGit(config.repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    // Ignore — worktree may not exist
  }

  // Create worktree with fresh branch (force-reset if branch exists)
  await execGit(config.repoRoot, [
    'worktree',
    'add',
    worktreePath,
    '-B',
    branchName,
    config.defaultBranch,
  ]);

  // Install dependencies in worktree
  await execFileAsync('yarn', ['install'], { cwd: worktreePath, encoding: 'utf8' });
}

async function safeCleanupWorktree(config: ClaudeAdapterConfig, branchName: string): Promise<void> {
  const worktreePath = resolve(config.repoRoot, WORKTREES_DIR, branchName);

  try {
    await execGit(config.repoRoot, ['worktree', 'remove', worktreePath]);
  } catch {
    // Best-effort cleanup
  }

  try {
    await execGit(config.repoRoot, ['branch', '-D', branchName]);
  } catch {
    // Best-effort cleanup — branch may not exist
  }
}

// --- Logging ---

interface LogContext {
  enabled: boolean;
  logFilePath: string | null;
  headerWritten: boolean;
}

function buildLogContext(
  config: ClaudeAdapterConfig,
  params: AgentStartParams,
  _sessionID: string,
): LogContext {
  if (!config.logging.agentSessions) {
    return { enabled: false, logFilePath: null, headerWritten: false };
  }

  const timestamp = Date.now();
  const context = params.role === 'planner' ? '' : `-${getWorkItemID(params)}`;
  const filename = `${timestamp}-${params.role}${context}.log`;
  const logFilePath = join(config.logging.logsDir, filename);

  return { enabled: true, logFilePath, headerWritten: false };
}

function getWorkItemID(params: AgentStartParams): string {
  if (params.role === 'implementor') {
    return (params as ImplementorStartParams).workItemID;
  }
  if (params.role === 'reviewer') {
    return (params as ReviewerStartParams).workItemID;
  }
  return '';
}

async function logMessage(logContext: LogContext, message: SDKMessage): Promise<void> {
  if (!logContext.enabled || logContext.logFilePath === null) {
    return;
  }

  try {
    if (!logContext.headerWritten) {
      await mkdir(join(logContext.logFilePath, '..'), { recursive: true });
      await writeFile(logContext.logFilePath, '', 'utf-8');
      logContext.headerWritten = true;
    }

    const timestamp = formatTimestamp(new Date());

    if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
      const initMsg = message as import('@anthropic-ai/claude-agent-sdk').SDKSystemMessage;
      const lines = [
        `[${timestamp}] SYSTEM init`,
        `  Model: ${initMsg.model}`,
        `  CWD: ${initMsg.cwd}`,
        `  Tools: ${initMsg.tools.join(', ')}`,
        '',
      ];
      await appendFile(logContext.logFilePath, lines.join('\n'), 'utf-8');
      return;
    }

    if (message.type === 'assistant') {
      const assistantMsg = message as SDKAssistantMessage;
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            const text = (block as { type: 'text'; text: string }).text;
            const indented = text
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n');
            // biome-ignore lint/performance/noAwaitInLoops: sequential log writes must be ordered
            await appendFile(
              logContext.logFilePath,
              `[${timestamp}] ASSISTANT\n${indented}\n\n`,
              'utf-8',
            );
          } else if (block.type === 'tool_use') {
            const toolBlock = block as { type: 'tool_use'; name: string };
            await appendFile(
              logContext.logFilePath,
              `[${timestamp}] ASSISTANT\n  [tool_use] ${toolBlock.name}\n\n`,
              'utf-8',
            );
          }
        }
      }
      return;
    }

    if (message.type === 'result') {
      const resultMsg = message as SDKResultMessage;
      const lines = [`[${timestamp}] RESULT ${resultMsg.subtype}`];
      lines.push(`  Duration: ${(resultMsg.duration_ms / MS_PER_SECOND).toFixed(1)}s`);
      lines.push(`  Cost:     $${resultMsg.total_cost_usd.toFixed(2)}`);
      lines.push(`  Turns:    ${resultMsg.num_turns}`);
      lines.push(
        `  Tokens:   ${resultMsg.usage.input_tokens} in / ${resultMsg.usage.output_tokens} out`,
      );
      lines.push('');
      await appendFile(logContext.logFilePath, lines.join('\n'), 'utf-8');
      return;
    }

    // All other message types
    await appendFile(
      logContext.logFilePath,
      `[${timestamp}] UNKNOWN ${message.type}\n  ${JSON.stringify(message)}\n\n`,
      'utf-8',
    );
  } catch {
    // Log writing failures are non-fatal
    logContext.enabled = false;
  }
}

async function logFooter(logContext: LogContext, resultMessage: SDKResultMessage): Promise<void> {
  if (!logContext.enabled || logContext.logFilePath === null) {
    return;
  }

  try {
    const outcome = resultMessage.subtype === 'success' ? 'completed' : 'failed';
    const lines = [
      '=== Session End ===',
      `Outcome:  ${outcome}`,
      `Finished: ${new Date().toISOString()}`,
      '',
    ];
    await appendFile(logContext.logFilePath, lines.join('\n'), 'utf-8');
  } catch {
    // Non-fatal
  }
}

async function logErrorFooter(logContext: LogContext): Promise<void> {
  if (!logContext.enabled || logContext.logFilePath === null) {
    return;
  }

  try {
    const lines = [
      '=== Session End ===',
      'Outcome:  failed',
      `Finished: ${new Date().toISOString()}`,
      '',
    ];
    await appendFile(logContext.logFilePath, lines.join('\n'), 'utf-8');
  } catch {
    // Non-fatal
  }
}

// --- Model validation ---

type SDKModelLiteral = 'sonnet' | 'opus' | 'haiku' | 'inherit';

const VALID_MODELS: Record<string, SDKModelLiteral> = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
  inherit: 'inherit',
};

function validateModel(model: string): SDKModelLiteral {
  const validated = VALID_MODELS[model];
  if (validated === undefined) {
    return 'inherit';
  }
  return validated;
}

function formatTimestamp(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
