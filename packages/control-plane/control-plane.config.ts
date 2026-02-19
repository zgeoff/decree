import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createGitHubProvider } from './src/engine/github-provider/create-github-provider.ts';
import type { GitHubProvider } from './src/engine/github-provider/types.ts';
import { validateBashCommand } from './src/engine/runtime-adapter/bash-validator/validate-bash-command.ts';
import { createClaudeAdapter } from './src/engine/runtime-adapter/create-claude-adapter.ts';
import type {
  BashValidatorHook,
  RuntimeAdapter,
  RuntimeAdapterDeps,
  ToolUseEvent,
} from './src/engine/runtime-adapter/types.ts';
import type { AgentRole } from './src/engine/state-store/domain-type-stubs.ts';
import type { AppConfig } from './src/engine/types.ts';

// ---------------------------------------------------------------------------
// Credentials & environment
// ---------------------------------------------------------------------------

const repository: string = 'zgeoff/decree';
const parts: string[] = repository.split('/');
const owner: string = parts[0] ?? '';
const repo: string = parts[1] ?? '';
const privateKey: string = readFileSync('./private-key.pem', 'utf-8');
const repoRoot: string = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

// ---------------------------------------------------------------------------
// Provider construction (async — top-level await)
// ---------------------------------------------------------------------------

const provider: GitHubProvider = await createGitHubProvider({
  appID: 2_869_121,
  privateKey,
  installationID: 110_243_522,
  owner,
  repo,
  specsDir: 'docs/specs/',
  defaultBranch: 'main',
});

// ---------------------------------------------------------------------------
// Runtime adapter factory
// ---------------------------------------------------------------------------

function buildBashValidatorHook(): BashValidatorHook {
  return async (event: ToolUseEvent) => {
    const command = typeof event.tool_input.command === 'string' ? event.tool_input.command : '';
    if (command === '') {
      return;
    }
    const result = validateBashCommand(command);
    if (result.allowed) {
      return;
    }
    return { decision: 'block', reason: result.reason };
  };
}

function createRuntimeAdapters(deps: RuntimeAdapterDeps): Record<AgentRole, RuntimeAdapter> {
  const adapter = createClaudeAdapter(
    {
      repoRoot,
      defaultBranch: 'main',
      contextPaths: ['.claude/CLAUDE.md'],
      bashValidatorHook: buildBashValidatorHook(),
      maxAgentDuration: 1800,
      logging: {
        agentSessions: true,
        logsDir: 'logs',
      },
    },
    deps,
  );
  return { planner: adapter, implementor: adapter, reviewer: adapter };
}

// ---------------------------------------------------------------------------
// Config export
// ---------------------------------------------------------------------------

const config: AppConfig = {
  repository,
  provider,
  createRuntimeAdapters,
};

// biome-ignore lint/style/noDefaultExport: config files use default export by convention
export default config;
