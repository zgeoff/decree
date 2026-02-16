import invariant from 'tiny-invariant';
import type { Spec } from '../../state-store/domain-type-stubs.ts';
import { mapTreeEntryToSpec } from '../mapping/map-tree-entry-to-spec.ts';
import { retryWithBackoff } from '../retry-with-backoff.ts';
import type { SpecProviderReader } from '../types.ts';

// --- Narrow Octokit interfaces ---

interface TreeEntry {
  path?: string;
  sha?: string;
  type?: string;
}

interface TreeResponse {
  data: {
    sha: string;
    tree: TreeEntry[];
  };
}

interface BlobResponse {
  data: {
    content: string;
    encoding: string;
  };
}

interface GitAPI {
  getTree: (params: GetTreeParams) => Promise<TreeResponse>;
  getBlob: (params: GetBlobParams) => Promise<BlobResponse>;
}

interface GetTreeParams {
  owner: string;
  repo: string;
  tree_sha: string;
  recursive?: string;
}

interface GetBlobParams {
  owner: string;
  repo: string;
  file_sha: string;
}

interface ContentItem {
  sha: string;
}

interface ContentResponse {
  data: ContentItem;
}

interface ReposAPI {
  getContent: (params: GetContentParams) => Promise<ContentResponse>;
}

interface GetContentParams {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export interface SpecReaderOctokit {
  git: GitAPI;
  repos: ReposAPI;
}

export interface SpecReaderConfig {
  owner: string;
  repo: string;
  specsDir: string;
  defaultBranch: string;
}

interface SpecCache {
  treeSHA: string;
  specs: Spec[];
}

export function createSpecReader(
  octokit: SpecReaderOctokit,
  config: SpecReaderConfig,
): SpecProviderReader {
  let cache: SpecCache | null = null;

  return {
    listSpecs: async (): Promise<Spec[]> => {
      const dirTreeSHA = await getSpecsDirTreeSHA(octokit, config);

      if (cache !== null && cache.treeSHA === dirTreeSHA) {
        return cache.specs;
      }

      const treeResponse = await retryWithBackoff(() =>
        octokit.git.getTree({
          owner: config.owner,
          repo: config.repo,
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
          octokit.git.getBlob({
            owner: config.owner,
            repo: config.repo,
            file_sha: entrySHA,
          }),
        );

        const content = decodeBase64(blobResponse.data.content);

        specs.push(
          mapTreeEntryToSpec(
            { path: entryPath, sha: entrySHA },
            { specsDir: config.specsDir, content },
          ),
        );
      }

      cache = { treeSHA: dirTreeSHA, specs };

      return specs;
    },
  };
}

async function getSpecsDirTreeSHA(
  octokit: SpecReaderOctokit,
  config: SpecReaderConfig,
): Promise<string> {
  const response = await retryWithBackoff(() =>
    octokit.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path: config.specsDir,
      ref: config.defaultBranch,
    }),
  );

  return response.data.sha;
}

function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  return Buffer.from(cleaned, 'base64').toString('utf-8');
}
