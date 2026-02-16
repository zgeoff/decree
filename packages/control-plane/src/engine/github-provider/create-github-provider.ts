import { createGitHubClient } from '../github-client/create-github-client.ts';
import type { GitHubClient } from '../github-client/types.ts';
import { createRevisionReader } from './readers/create-revision-reader.ts';
import { createSpecReader } from './readers/create-spec-reader.ts';
import { createWorkItemReader } from './readers/create-work-item-reader.ts';
import { retryWithBackoff } from './retry-with-backoff.ts';
import type { GitHubProvider, GitHubProviderConfig } from './types.ts';
import { createRevisionWriter } from './writers/create-revision-writer.ts';
import { createWorkItemWriter } from './writers/create-work-item-writer.ts';

export async function createGitHubProvider(config: GitHubProviderConfig): Promise<GitHubProvider> {
  const client = createGitHubClient({
    appID: config.appID,
    privateKey: config.privateKey,
    installationID: config.installationID,
  });

  const botUsername = await resolveBotUsername(client);

  const workItemReader = createWorkItemReader({
    client,
    config: { owner: config.owner, repo: config.repo },
  });

  const workItemWriter = createWorkItemWriter({
    client,
    config: { owner: config.owner, repo: config.repo },
  });

  const revisionReader = createRevisionReader({
    client,
    config: { owner: config.owner, repo: config.repo, botUsername },
  });

  const revisionWriter = createRevisionWriter({
    client,
    config: {
      owner: config.owner,
      repo: config.repo,
      defaultBranch: config.defaultBranch,
    },
  });

  const specReader = createSpecReader({
    client,
    config: {
      owner: config.owner,
      repo: config.repo,
      specsDir: config.specsDir,
      defaultBranch: config.defaultBranch,
    },
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

async function resolveBotUsername(client: GitHubClient): Promise<string> {
  const response = await retryWithBackoff(() => client.apps.getAuthenticated());
  return `${response.data.slug}[bot]`;
}
