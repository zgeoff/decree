import { vi } from 'vitest';
import type { WorkProviderWriter } from '../engine/github-provider/types.ts';
import type { WorkItem } from '../engine/state-store/types.ts';
import { buildWorkItem } from './build-work-item.ts';

export interface MockWorkProviderWriterResult {
  writer: WorkProviderWriter;
  calls: {
    transitionStatus: Array<{ workItemID: string; newStatus: string }>;
    createWorkItem: Array<{ title: string; body: string; labels: string[]; blockedBy: string[] }>;
    updateWorkItem: Array<{
      workItemID: string;
      body: string | null;
      labels: string[] | null;
    }>;
  };
}

export function createMockWorkProviderWriter(): MockWorkProviderWriterResult {
  const calls: MockWorkProviderWriterResult['calls'] = {
    transitionStatus: [],
    createWorkItem: [],
    updateWorkItem: [],
  };

  const writer: WorkProviderWriter = {
    transitionStatus: vi.fn().mockImplementation(async (workItemID: string, newStatus: string) => {
      calls.transitionStatus.push({ workItemID, newStatus });
    }),
    createWorkItem: vi
      .fn()
      .mockImplementation(
        async (
          title: string,
          body: string,
          labels: string[],
          blockedBy: string[],
        ): Promise<WorkItem> => {
          calls.createWorkItem.push({ title, body, labels, blockedBy });
          return buildWorkItem({ id: '99', title });
        },
      ),
    updateWorkItem: vi
      .fn()
      .mockImplementation(
        async (workItemID: string, body: string | null, labels: string[] | null) => {
          calls.updateWorkItem.push({ workItemID, body, labels });
        },
      ),
  };

  return { writer, calls };
}
