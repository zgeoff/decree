import { execFile } from 'node:child_process';
import { appendFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  HookCallback,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { Logger } from '../create-logger.ts';
import type { AgentResult } from '../state-store/domain-type-stubs.ts';
import { buildImplementorContext } from './context-assembly/build-implementor-context.ts';
import { buildPlannerContext } from './context-assembly/build-planner-context.ts';
import { buildReviewerContext } from './context-assembly/build-reviewer-context.ts';
import { extractPatch } from './extract-patch.ts';
import { loadAgentDefinition } from './load-agent-definition.ts';
import { ImplementorOutputSchema, PlannerOutputSchema, ReviewerOutputSchema } from './schemas.ts';
import type {
  AgentRunHandle,
  AgentStartParams,
  BashValidatorHook,
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterDeps,
  ToolUseEvent,
} from './types.ts';

// --- Types ---

type SDKModelLiteral = 'sonnet' | 'opus' | 'haiku' | 'inherit';

/**
 * Narrowed SDK agent definition — captures only the fields we pass to `query()`.
 */
interface SDKAgentDefinition {
  description: string;
  tools: string[];
  disallowedTools: string[];
  model: SDKModelLiteral;
  prompt: string;
}

/**
 * Narrowed SDK hook input for tool-use events — internal type with same shape as ToolUseEvent.
 */
type ToolUseHookInput = ToolUseEvent;

interface ExecResult {
  stdout: string;
  stderr: string;
}

// BashValidatorHook is re-exported from types.ts
export type { BashValidatorHook } from './types.ts';

/**
 * Configuration for the Claude adapter, extending the base runtime adapter config.
 */
export interface ClaudeAdapterConfig extends RuntimeAdapterConfig {
  repoRoot: string;
  defaultBranch: string;
  contextPaths: string[];
  bashValidatorHook: BashValidatorHook;
  logger: Logger;
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
  let workingDirectory = config.repoRoot;
  let branchName: string | null = null;

  // Step 1: Worktree setup (Implementor only)
  if (params.role === 'implementor') {
    branchName = params.branchName;
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

    const hookCallback: HookCallback = async (input: unknown) => {
      if (!isToolUseHookInput(input)) {
        return { decision: 'approve' };
      }
      const result = await config.bashValidatorHook({
        tool_name: input.tool_name,
        tool_input: input.tool_input,
      });
      return result ?? { decision: 'approve' };
    };

    const sdkDefinition: SDKAgentDefinition = {
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
          const chunk = outputBuffer.shift();
          invariant(chunk !== undefined, 'output buffer must have items when length > 0');
          yield chunk;
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
        abortController.abort('timeout');
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
      abortSignal: abortController.signal,
    };
  } catch (error) {
    if (params.role === 'implementor' && branchName !== null) {
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
  session.abortController.abort('cancelled');
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

async function processSession(opts: ProcessSessionParams): Promise<AgentResult> {
  try {
    let resultMessage: SDKResultMessage | null = null;

    for await (const message of opts.q) {
      // Log message if logging enabled
      await logMessage(opts.logContext, message, opts.config.logger);

      if (message.type === 'assistant') {
        extractTextFromAssistant(message, opts.pushOutput);
      }

      if (message.type === 'result') {
        resultMessage = message;
      }
    }

    opts.endOutput();

    if (resultMessage === null) {
      throw new Error('Agent session ended without a result message');
    }

    // Check for SDK-level failure before writing footer
    if (resultMessage.subtype !== 'success') {
      await logFooter(opts.logContext, 'failed');
      throw new Error(`Agent session failed: ${resultMessage.subtype}`);
    }

    // Write session footer
    await logFooter(opts.logContext, 'completed');

    // Validate structured output
    return await assembleResult(opts.params, opts.config, resultMessage);
  } catch (error) {
    opts.endOutput();
    const outcome = resolveFailureOutcome(opts.sessions, opts.sessionID);
    await logFooter(opts.logContext, outcome);
    throw error;
  } finally {
    if (opts.timeoutHandle !== null) {
      clearTimeout(opts.timeoutHandle);
    }

    // Cleanup worktree for implementor
    if (opts.params.role === 'implementor') {
      await safeCleanupWorktree(opts.config, opts.params.branchName);
    }

    opts.sessions.delete(opts.sessionID);
  }
}

// --- Result assembly ---

interface SDKSuccessResult {
  structured_output?: unknown;
}

async function assembleResult(
  params: AgentStartParams,
  config: ClaudeAdapterConfig,
  successResult: SDKSuccessResult,
): Promise<AgentResult> {
  const structuredOutput = successResult.structured_output;

  if (params.role === 'planner') {
    const parseResult = PlannerOutputSchema.safeParse(structuredOutput);
    if (!parseResult.success) {
      throw new Error(`Planner output validation failed: ${parseResult.error.message}`);
    }
    return parseResult.data;
  }

  if (params.role === 'reviewer') {
    const parseResult = ReviewerOutputSchema.safeParse(structuredOutput);
    if (!parseResult.success) {
      throw new Error(`Reviewer output validation failed: ${parseResult.error.message}`);
    }
    return parseResult.data;
  }

  // Implementor
  const parseResult = ImplementorOutputSchema.safeParse(structuredOutput);
  if (!parseResult.success) {
    throw new Error(`Implementor output validation failed: ${parseResult.error.message}`);
  }

  const implementorOutput = parseResult.data;

  let patch: string | null = null;

  if (implementorOutput.outcome === 'completed') {
    const worktreeDir = resolve(config.repoRoot, WORKTREES_DIR, params.branchName);
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
    return buildPlannerContext(params, deps.getState, {
      repoRoot: config.repoRoot,
      workItemReader: deps.workItemReader,
      gitShowBlob: async (blobSHA: string): Promise<string> => {
        const result = await execGit(config.repoRoot, ['show', blobSHA]);
        return result.stdout;
      },
      createDiff: async (
        oldContent: string,
        newContent: string,
        filePath: string,
      ): Promise<string> => createUnifiedDiff(config.repoRoot, oldContent, newContent, filePath),
    });
  }

  if (params.role === 'implementor') {
    return buildImplementorContext(params, {
      workItemReader: deps.workItemReader,
      revisionReader: deps.revisionReader,
      getState: deps.getState,
      getReviewHistory: deps.getReviewHistory,
    });
  }

  // Reviewer
  return buildReviewerContext({
    params,
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
    if (isTextBlock(block)) {
      pushOutput(block.text);
    }
  }
}

// --- Session ID ---

function buildSessionID(params: AgentStartParams): string {
  if (params.role === 'planner') {
    return `planner-${Date.now()}`;
  }
  if (params.role === 'implementor') {
    return `implementor-${params.workItemID}-${Date.now()}`;
  }
  return `reviewer-${params.workItemID}-${Date.now()}`;
}

// --- Worktree management ---

// promisify(execFile) overload resolution requires cast — genuine TS limitation
const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
) => Promise<ExecResult>;

async function execGit(cwd: string, args: string[]): Promise<ExecResult> {
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
    await execGit(config.repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    // Best-effort cleanup
  }

  try {
    await execGit(config.repoRoot, ['branch', '-D', branchName]);
  } catch {
    // Best-effort cleanup — branch may not exist
  }
}

// --- Diff ---

async function createUnifiedDiff(
  repoRoot: string,
  oldContent: string,
  newContent: string,
  filePath: string,
): Promise<string> {
  const tmpDir = tmpdir();
  const stamp = Date.now();
  const oldTmp = join(tmpDir, `decree-diff-old-${stamp}`);
  const newTmp = join(tmpDir, `decree-diff-new-${stamp}`);

  try {
    await writeFile(oldTmp, oldContent, 'utf-8');
    await writeFile(newTmp, newContent, 'utf-8');

    const result = await execGit(repoRoot, ['diff', '--no-index', oldTmp, newTmp]).catch(
      (error: ExecError) => {
        // git diff --no-index exits 1 when files differ — that is expected
        if (error.code === 1 && error.stdout) {
          return { stdout: error.stdout, stderr: '' };
        }
        throw error;
      },
    );

    // Replace temp file paths with semantic a/b paths
    const output = result.stdout
      .replace(new RegExp(escapeRegExp(oldTmp), 'g'), `a/${filePath}`)
      .replace(new RegExp(escapeRegExp(newTmp), 'g'), `b/${filePath}`);
    return output;
  } finally {
    // Best-effort cleanup of temp files
    await unlink(oldTmp).catch(() => undefined);
    await unlink(newTmp).catch(() => undefined);
  }
}

interface ExecError {
  code: number;
  stdout: string;
  stderr: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Logging ---

type SessionOutcome = 'completed' | 'failed' | 'cancelled';

interface LogContext {
  enabled: boolean;
  logFilePath: string | null;
  headerWritten: boolean;
  footerWritten: boolean;
  params: AgentStartParams;
  sessionID: string;
  startedAt: string;
}

function buildLogContext(
  config: ClaudeAdapterConfig,
  params: AgentStartParams,
  sessionID: string,
): LogContext {
  const startedAt = new Date().toISOString();

  if (!config.logging.agentSessions) {
    return {
      enabled: false,
      logFilePath: null,
      headerWritten: false,
      footerWritten: false,
      params,
      sessionID,
      startedAt,
    };
  }

  const timestamp = Date.now();
  const context = params.role === 'planner' ? '' : `-${getWorkItemID(params)}`;
  const filename = `${timestamp}-${params.role}${context}.log`;
  const logFilePath = join(config.logging.logsDir, filename);
  return {
    enabled: true,
    logFilePath,
    headerWritten: false,
    footerWritten: false,
    params,
    sessionID,
    startedAt,
  };
}

function getWorkItemID(params: AgentStartParams): string {
  if (params.role === 'implementor') {
    return params.workItemID;
  }
  if (params.role === 'reviewer') {
    return params.workItemID;
  }
  return '';
}

async function logMessage(
  logContext: LogContext,
  message: SDKMessage,
  logger: Logger,
): Promise<void> {
  if (!logContext.enabled || logContext.logFilePath === null) {
    return;
  }

  if (message.type === 'system' && message.subtype === 'init') {
    if (!logContext.headerWritten) {
      try {
        await mkdir(join(logContext.logFilePath, '..'), { recursive: true });
        const header = buildSessionHeader(logContext);
        await writeFile(logContext.logFilePath, header, 'utf-8');
        logContext.headerWritten = true;
      } catch (error: unknown) {
        logger.error('log file creation failed, disabling session logging', {
          logFilePath: logContext.logFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
        logContext.enabled = false;
        logContext.logFilePath = null;
        return;
      }
    }
    try {
      const timestamp = formatTimestamp(new Date());
      const lines = [
        `[${timestamp}] SYSTEM init`,
        `  Model: ${message.model}`,
        `  CWD: ${message.cwd}`,
        `  Tools: ${message.tools.join(', ')}`,
        '',
      ];
      await appendFile(logContext.logFilePath, lines.join('\n'), 'utf-8');
    } catch (error: unknown) {
      logger.error('mid-session log write failed, disabling logging', {
        logFilePath: logContext.logFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      logContext.enabled = false;
    }
    return;
  }

  // Guard: if header hasn't been written yet, skip non-init messages
  if (!logContext.headerWritten) {
    return;
  }

  try {
    const timestamp = formatTimestamp(new Date());

    if (message.type === 'assistant') {
      if (message.message?.content) {
        for (const block of message.message.content) {
          if (isTextBlock(block)) {
            const indented = block.text
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n');
            // biome-ignore lint/performance/noAwaitInLoops: sequential log writes must be ordered
            await appendFile(
              logContext.logFilePath,
              `[${timestamp}] ASSISTANT\n${indented}\n\n`,
              'utf-8',
            );
          } else if (isToolUseBlock(block)) {
            await appendFile(
              logContext.logFilePath,
              `[${timestamp}] ASSISTANT\n  [tool_use] ${block.name}\n\n`,
              'utf-8',
            );
          }
        }
      }
      return;
    }

    if (message.type === 'result') {
      const lines = [`[${timestamp}] RESULT ${message.subtype}`];
      lines.push(`  Duration: ${(message.duration_ms / MS_PER_SECOND).toFixed(1)}s`);
      lines.push(`  Cost:     $${message.total_cost_usd.toFixed(2)}`);
      lines.push(`  Turns:    ${message.num_turns}`);
      lines.push(
        `  Tokens:   ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`,
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
  } catch (error: unknown) {
    logger.error('mid-session log write failed, disabling logging', {
      logFilePath: logContext.logFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    logContext.enabled = false;
  }
}

async function logFooter(logContext: LogContext, outcome: SessionOutcome): Promise<void> {
  if (
    !logContext.enabled ||
    logContext.logFilePath === null ||
    logContext.footerWritten ||
    !logContext.headerWritten
  ) {
    return;
  }

  try {
    logContext.footerWritten = true;
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

function resolveFailureOutcome(
  sessions: Map<string, ActiveSession>,
  sessionID: string,
): SessionOutcome {
  const session = sessions.get(sessionID);
  if (session?.abortController.signal.aborted) {
    return 'cancelled';
  }
  return 'failed';
}

function buildSessionHeader(logContext: LogContext): string {
  const lines = [
    '=== Agent Session ===',
    `Type:       ${logContext.params.role}`,
    `Session ID: ${logContext.sessionID}`,
    buildContextField(logContext.params),
    `Started:    ${logContext.startedAt}`,
    '',
    '=== Messages ===',
    '',
  ];
  return lines.join('\n');
}

function buildContextField(params: AgentStartParams): string {
  if (params.role === 'planner') {
    return `Spec Paths: ${params.specPaths.join(', ')}`;
  }
  return `Issue:      #${params.workItemID}`;
}

// --- Model validation ---

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

// --- Type guards ---

function isToolUseHookInput(value: unknown): value is ToolUseHookInput {
  return typeof value === 'object' && value !== null && 'tool_name' in value;
}

function isTextBlock(block: { type: string }): block is { type: 'text'; text: string } {
  return block.type === 'text';
}

function isToolUseBlock(block: { type: string }): block is { type: 'tool_use'; name: string } {
  return block.type === 'tool_use';
}

function formatTimestamp(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
