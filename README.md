<div align="center">

<img src="logo.png" alt="decree" width="128" />

# decree

**Agentic development workflow control plane**

[![CI](https://github.com/zgeoff/decree/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/zgeoff/decree/actions/workflows/main.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org)
[![Yarn](https://img.shields.io/badge/yarn-4.12.0-2C8EBB.svg)](https://yarnpkg.com)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-3178C6.svg)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Getting Started](#getting-started) • [Commands](#commands) • [Architecture](#architecture) •
[Development Workflow](#development-workflow) • [License](#license)

</div>

<br />

## WARNING

99% of this project is AI written as a learning excersize. approximately 0 safeguards/sandboxing at
the moment. do not use.

## Getting Started

**decree** is spec-driven agentic development workflow orchestration tool. It currently is heavily
integrated with Github, automatically decomposing modified specs into issues and dispatching agents
for implementation & review.

### Prerequisites

- Node.js 24+
- Yarn 4.12.0+
- GitHub App with `issues:read`, `issues:write`, `contents:read`, `pulls:read`, `checks:read`
  permissions
- Claude Agent SDK authentication key

### Installation

```bash
# Clone repository
git clone https://github.com/zgeoff/decree.git
cd decree

# Install dependencies
yarn install
```

### Configuration

Create a config file at `packages/control-plane/control-plane.config.ts`:

```ts
import type { ControlPlaneConfig } from "@decree/control-plane";

export const config: ControlPlaneConfig = {
  // GitHub repository
  repository: "owner/repo",

  // GitHub App credentials
  githubAppID: 123456,
  githubAppPrivateKeyPath: "/path/to/private-key.pem",
  githubAppInstallationID: 654321,

  // Polling intervals (seconds)
  issuePoller: { pollInterval: 30 },
  specPoller: { pollInterval: 60 },
  prPoller: { pollInterval: 30 },

  // Logging
  logLevel: "info",
  logging: {
    agentSessions: true,
    logsDir: "logs",
  },
};
```

### Running

```bash
# Start control plane
yarn control-plane
```

## Commands

| Command              | Description                   |
| -------------------- | ----------------------------- |
| `yarn build`         | Build all packages            |
| `yarn test`          | Run tests across workspace    |
| `yarn lint`          | Lint all packages             |
| `yarn typecheck`     | TypeScript type checking      |
| `yarn format`        | Format code with Biome        |
| `yarn check`         | Run lint, typecheck, and test |
| `yarn control-plane` | Start control plane TUI       |

### Working with packages

```bash
# Run a command in a specific package
yarn workspace @decree/control-plane test

# Run a command with Turborepo filtering
yarn turbo run build --filter=@decree/control-plane
```

## Architecture

decree consists of a single package `@decree/control-plane` that provides:

- **Engine** — Polling, state management, change detection, agent lifecycle, and dispatch logic
- **TUI** — Ink-based (React for terminal) dashboard that renders engine state

```
decree/
├── packages/
│   └── control-plane/    # Main package (@decree/control-plane)
│       ├── src/           # Source code
│       ├── docs/           # Spec files
│       └── .claude/         # Agent definitions
├── scripts/              # Shell scripts (BATS tests, etc.)
├── biome.jsonc           # Linting and formatting
├── turbo.json            # Build orchestration
└── package.json           # Workspace root
```

### Stack

- **Language** — TypeScript
- **Execution** — `tsx` (no build step)
- **Package** — `@decree/control-plane`
- **TUI framework** — Ink (React for terminal)
- **TUI state management** — Zustand
- **GitHub API** — `@octokit/rest`
- **GitHub Auth** — `@octokit/auth-app`
- **Agent invocation** — `@anthropic-ai/claude-agent-sdk`
- **Package Manager** — Yarn Berry (PnP + Zero Installs)
- **Build System** — Turborepo
- **Linting/Formatting** — Biome
- **Testing** — Vitest
- **Git Hooks** — Lefthook

## Development Workflow

This project uses an AI-assisted development workflow — specs are the source of truth, task state
lives in GitHub Issues, and agents handle planning, implementation, and review. A TUI control plane
(`yarn control-plane`) orchestrates it all.

See [`docs/specs/decree/`](docs/specs/decree/) for full specifications.

### Agents

decree includes three agent types:

| Agent       | Purpose                                 | Trigger                               |
| ----------- | --------------------------------------- | ------------------------------------- |
| Planner     | Reads specs, creates task issues        | Spec changes (approved only)          |
| Implementor | Implements tasks from issues            | User dispatch / after review feedback |
| Reviewer    | Reviews PRs against acceptance criteria | After Implementor completes with PR   |

## License

[MIT](LICENSE)
