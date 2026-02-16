import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { RevisionReaderOctokit } from './readers/create-revision-reader.ts';
import { createRevisionReader } from './readers/create-revision-reader.ts';
import type { SpecReaderOctokit } from './readers/create-spec-reader.ts';
import { createSpecReader } from './readers/create-spec-reader.ts';
import type { WorkItemReaderOctokit } from './readers/create-work-item-reader.ts';
import { createWorkItemReader } from './readers/create-work-item-reader.ts';
import { retryWithBackoff } from './retry-with-backoff.ts';
import type { GitHubProvider, GitHubProviderConfig } from './types.ts';
import type { RevisionWriterOctokit } from './writers/create-revision-writer.ts';
import { createRevisionWriter } from './writers/create-revision-writer.ts';
import type { WorkItemWriterOctokit } from './writers/create-work-item-writer.ts';
import { createWorkItemWriter } from './writers/create-work-item-writer.ts';

// The Octokit SDK uses complex generic types with `RequestParameters` index signatures.
// The reader/writer narrow interfaces intentionally omit these index signatures for type safety.
// This boundary type bridges the gap by asserting that the real Octokit satisfies all narrow
// interfaces — which it does at runtime, since the narrow interfaces are strict subsets of the
// full Octokit API surface.
type NarrowOctokit = RevisionReaderOctokit &
  RevisionWriterOctokit &
  SpecReaderOctokit &
  WorkItemReaderOctokit &
  WorkItemWriterOctokit &
  OctokitWithApps;

export async function createGitHubProvider(config: GitHubProviderConfig): Promise<GitHubProvider> {
  const octokit = createOctokit(config);
  const botUsername = await resolveBotUsername(octokit);

  const workItemReader = createWorkItemReader(octokit, {
    owner: config.owner,
    repo: config.repo,
  });

  const workItemWriter = createWorkItemWriter({
    octokit,
    config: { owner: config.owner, repo: config.repo },
  });

  const revisionReader = createRevisionReader(octokit, {
    owner: config.owner,
    repo: config.repo,
    botUsername,
  });

  const revisionWriter = createRevisionWriter({
    octokit,
    config: {
      owner: config.owner,
      repo: config.repo,
      defaultBranch: config.defaultBranch,
    },
  });

  const specReader = createSpecReader(octokit, {
    owner: config.owner,
    repo: config.repo,
    specsDir: config.specsDir,
    defaultBranch: config.defaultBranch,
  });

  return {
    workItemReader,
    workItemWriter,
    revisionReader,
    revisionWriter,
    specReader,
  };
}

// --- Helpers ---

interface AppResponse {
  data: {
    slug: string;
  };
}

interface AppsAPI {
  getAuthenticated: () => Promise<AppResponse>;
}

interface OctokitWithApps {
  apps: AppsAPI;
}

// Isolates the `as` cast to a single point. The real Octokit structurally satisfies all narrow
// reader/writer interfaces at runtime — the incompatibility is purely a TypeScript limitation
// caused by the SDK's `RequestParameters` index signatures vs. the narrow interfaces' strict
// parameter types.
function createOctokit(config: GitHubProviderConfig): NarrowOctokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appID,
      privateKey: config.privateKey,
      installationId: config.installationID,
    },
  }) as unknown as NarrowOctokit;
}

async function resolveBotUsername(octokit: OctokitWithApps): Promise<string> {
  const response = await retryWithBackoff(() => octokit.apps.getAuthenticated());
  return `${response.data.slug}[bot]`;
}
