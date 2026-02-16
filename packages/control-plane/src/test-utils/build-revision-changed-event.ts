import type { RevisionChanged } from '../engine/state-store/types.ts';

export function buildRevisionChangedEvent(overrides?: Partial<RevisionChanged>): RevisionChanged {
  return {
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-1',
    revision: {
      id: 'rev-1',
      title: 'Test revision',
      url: 'https://example.com/pr/1',
      headSHA: 'abc123',
      headRef: 'feature/test',
      author: 'test-user',
      body: 'Test body',
      isDraft: false,
      workItemID: 'wi-1',
      pipeline: null,
      reviewID: null,
    },
    oldPipelineStatus: null,
    newPipelineStatus: null,
    ...overrides,
  };
}
