import type { EngineConfig } from './src/types.ts';

const config: EngineConfig = {
  // Required: GitHub repository in owner/repo format
  repository: 'zgeoff/decree',

  // Required: GitHub App credentials
  githubAppID: 2_869_121,
  githubAppPrivateKeyPath: './private-key.pem',
  githubAppInstallationID: 110_243_522,

  logging: {
    agentSessions: true,
  },

  // Optional: Logging verbosity (default: 'info')
  // logLevel: 'debug',

  // Optional: Seconds to wait for agents during shutdown (default: 300)
  // shutdownTimeout: 300,

  // Optional: IssuePoller settings
  // issuePoller: {
  //   pollInterval: 30, // seconds between poll cycles
  // },

  // Optional: SpecPoller settings
  // specPoller: {
  //   pollInterval: 60,        // seconds between poll cycles
  //   specsDir: 'docs/specs/', // path to specs directory (relative to repo root)
  //   defaultBranch: 'main',   // branch to monitor for spec changes
  // },

  // Optional: Agent settings
  agents: {
    agentPlanner: 'planner',
    agentImplementor: 'implementor',
    agentReviewer: 'reviewer',
    maxAgentDuration: 1800, // seconds before agent is cancelled
  },
};

// biome-ignore lint/style/noDefaultExport: config files use default export by convention
export default config;
