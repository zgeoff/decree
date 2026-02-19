import { vi } from 'vitest';
import type { WorkProviderReader } from '../engine/github-provider/types.ts';

export interface MockWorkProviderReaderConfig {
  listWorkItems?: WorkProviderReader['listWorkItems'];
  getWorkItem?: WorkProviderReader['getWorkItem'];
  getWorkItemBody?: WorkProviderReader['getWorkItemBody'];
}

export function createMockWorkProviderReader(
  config?: MockWorkProviderReaderConfig,
): WorkProviderReader {
  return {
    listWorkItems: config?.listWorkItems ?? vi.fn().mockResolvedValue([]),
    getWorkItem: config?.getWorkItem ?? vi.fn().mockResolvedValue(null),
    getWorkItemBody: config?.getWorkItemBody ?? vi.fn().mockResolvedValue(''),
  };
}
