export interface TreeEntryOverrides {
  path?: string;
  sha?: string;
  type?: string;
}

interface TreeEntryData {
  path: string;
  sha: string;
  type: string;
}

export function buildTreeEntry(overrides?: TreeEntryOverrides): TreeEntryData {
  return {
    path: overrides?.path ?? 'decree/workflow.md',
    sha: overrides?.sha ?? 'blob-sha-1',
    type: overrides?.type ?? 'blob',
  };
}
