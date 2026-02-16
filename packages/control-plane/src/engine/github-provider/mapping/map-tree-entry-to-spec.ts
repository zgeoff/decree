import type { Spec, SpecFrontmatterStatus } from '../../state-store/domain-type-stubs.ts';

export interface GitHubTreeEntryInput {
  path: string;
  sha: string;
}

export interface MapTreeEntryOptions {
  specsDir: string;
  content: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const STATUS_RE = /^status:\s*(.+)$/m;

const VALID_FRONTMATTER_STATUSES: Record<string, SpecFrontmatterStatus> = {
  draft: 'draft',
  approved: 'approved',
  deprecated: 'deprecated',
};

export function mapTreeEntryToSpec(
  entry: GitHubTreeEntryInput,
  options: MapTreeEntryOptions,
): Spec {
  const filePath = buildFilePath(options.specsDir, entry.path);
  const frontmatterStatus = parseFrontmatterStatus(options.content);

  return {
    filePath,
    blobSHA: entry.sha,
    frontmatterStatus,
  };
}

function buildFilePath(specsDir: string, entryPath: string): string {
  const normalizedDir = specsDir.endsWith('/') ? specsDir : `${specsDir}/`;
  return `${normalizedDir}${entryPath}`;
}

function parseFrontmatterStatus(content: string): SpecFrontmatterStatus {
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (!fmMatch?.[1]) {
    return 'draft';
  }

  const statusMatch = STATUS_RE.exec(fmMatch[1]);
  const rawStatus = statusMatch?.[1]?.trim();

  if (!rawStatus) {
    return 'draft';
  }

  return VALID_FRONTMATTER_STATUSES[rawStatus] ?? 'draft';
}
