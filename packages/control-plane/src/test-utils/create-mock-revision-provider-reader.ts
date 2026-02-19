import { vi } from 'vitest';
import type { RevisionProviderReader } from '../engine/github-provider/types.ts';

export interface MockRevisionProviderReaderConfig {
  listRevisions?: RevisionProviderReader['listRevisions'];
  getRevision?: RevisionProviderReader['getRevision'];
  getRevisionFiles?: RevisionProviderReader['getRevisionFiles'];
  getReviewHistory?: RevisionProviderReader['getReviewHistory'];
}

export function createMockRevisionProviderReader(
  config?: MockRevisionProviderReaderConfig,
): RevisionProviderReader {
  return {
    listRevisions: config?.listRevisions ?? vi.fn().mockResolvedValue([]),
    getRevision: config?.getRevision ?? vi.fn().mockResolvedValue(null),
    getRevisionFiles: config?.getRevisionFiles ?? vi.fn().mockResolvedValue([]),
    getReviewHistory:
      config?.getReviewHistory ?? vi.fn().mockResolvedValue({ reviews: [], inlineComments: [] }),
  };
}
