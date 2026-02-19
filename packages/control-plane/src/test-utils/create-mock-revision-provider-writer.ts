import { vi } from 'vitest';
import type { RevisionProviderWriter } from '../engine/github-provider/types.ts';
import type { AgentReview, Revision } from '../engine/state-store/types.ts';
import { buildRevision } from './build-revision.ts';

export interface MockRevisionProviderWriterResult {
  writer: RevisionProviderWriter;
  calls: {
    createFromPatch: Array<{ workItemID: string; patch: string; branchName: string }>;
    updateBody: Array<{ revisionID: string; body: string }>;
    postReview: Array<{ revisionID: string; review: AgentReview }>;
    updateReview: Array<{ revisionID: string; reviewID: string; review: AgentReview }>;
    postComment: Array<{ revisionID: string; body: string }>;
  };
}

export function createMockRevisionProviderWriter(): MockRevisionProviderWriterResult {
  const calls: MockRevisionProviderWriterResult['calls'] = {
    createFromPatch: [],
    updateBody: [],
    postReview: [],
    updateReview: [],
    postComment: [],
  };

  const writer: RevisionProviderWriter = {
    createFromPatch: vi
      .fn()
      .mockImplementation(
        async (workItemID: string, patch: string, branchName: string): Promise<Revision> => {
          calls.createFromPatch.push({ workItemID, patch, branchName });
          return buildRevision({ id: '99' });
        },
      ),
    updateBody: vi.fn().mockImplementation(async (revisionID: string, body: string) => {
      calls.updateBody.push({ revisionID, body });
    }),
    postReview: vi
      .fn()
      .mockImplementation(async (revisionID: string, review: AgentReview): Promise<string> => {
        calls.postReview.push({ revisionID, review });
        return 'review-99';
      }),
    updateReview: vi
      .fn()
      .mockImplementation(async (revisionID: string, reviewID: string, review: AgentReview) => {
        calls.updateReview.push({ revisionID, reviewID, review });
      }),
    postComment: vi.fn().mockImplementation(async (revisionID: string, body: string) => {
      calls.postComment.push({ revisionID, body });
    }),
  };

  return { writer, calls };
}
