import invariant from 'tiny-invariant';
import type { GitHubClient } from '../../github-client/types.ts';
import type { Spec } from '../../state-store/domain-type-stubs.ts';
import { mapTreeEntryToSpec } from '../mapping/map-tree-entry-to-spec.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { SpecProviderReader } from '../types.ts';

export interface SpecReaderConfig {
  owner: string;
  repo: string;
  specsDir: string;
  defaultBranch: string;
}

export interface SpecReaderDeps {
  client: GitHubClient;
  config: SpecReaderConfig;
}

interface SpecCache {
  treeSHA: string;
  specs: Spec[];
}

export function createSpecReader(deps: SpecReaderDeps): SpecProviderReader {
  let cache: SpecCache | null = null;

  return {
    listSpecs: async (): Promise<Spec[]> => {
      const dirTreeSHA = await getSpecsDirTreeSHA(deps);

      if (cache !== null && cache.treeSHA === dirTreeSHA) {
        return cache.specs;
      }

      const treeResponse = await retryWithBackoff(() =>
        deps.client.git.getTree({
          owner: deps.config.owner,
          repo: deps.config.repo,
          tree_sha: dirTreeSHA,
          recursive: '1',
        }),
      );

      const blobEntries = treeResponse.data.tree.filter(
        (entry) => entry.type === 'blob' && entry.path !== undefined && entry.sha !== undefined,
      );

      const specs: Spec[] = [];

      for (const entry of blobEntries) {
        invariant(entry.sha, 'tree entry sha must be defined after filter');
        invariant(entry.path, 'tree entry path must be defined after filter');

        const entrySHA = entry.sha;
        const entryPath = entry.path;

        // biome-ignore lint/performance/noAwaitInLoops: sequential to fail on first error per spec requirements
        const blobResponse = await retryWithBackoff(() =>
          deps.client.git.getBlob({
            owner: deps.config.owner,
            repo: deps.config.repo,
            file_sha: entrySHA,
          }),
        );

        const content = decodeBase64(blobResponse.data.content);

        specs.push(
          mapTreeEntryToSpec(
            { path: entryPath, sha: entrySHA },
            { specsDir: deps.config.specsDir, content },
          ),
        );
      }

      cache = { treeSHA: dirTreeSHA, specs };

      return specs;
    },
  };
}

async function getSpecsDirTreeSHA(deps: SpecReaderDeps): Promise<string> {
  const response = await retryWithBackoff(() =>
    deps.client.repos.getContent({
      owner: deps.config.owner,
      repo: deps.config.repo,
      path: deps.config.specsDir,
      ref: deps.config.defaultBranch,
    }),
  );

  invariant(response.data.sha, 'specs directory content must have a sha');
  return response.data.sha;
}

function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  return Buffer.from(cleaned, 'base64').toString('utf-8');
}
