import { vi } from 'vitest';
import type { SpecProviderReader } from '../engine/github-provider/types.ts';

export interface MockSpecProviderReaderConfig {
  listSpecs?: SpecProviderReader['listSpecs'];
  getDefaultBranchSHA?: SpecProviderReader['getDefaultBranchSHA'];
}

export function createMockSpecProviderReader(
  config?: MockSpecProviderReaderConfig,
): SpecProviderReader {
  return {
    listSpecs: config?.listSpecs ?? vi.fn().mockResolvedValue([]),
    getDefaultBranchSHA: config?.getDefaultBranchSHA ?? vi.fn().mockResolvedValue('main-sha-1'),
  };
}
