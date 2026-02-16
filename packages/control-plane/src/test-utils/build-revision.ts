import type { Revision } from '../engine/state-store/types.ts';

export function buildRevision(overrides: Partial<Revision> & { id: string }): Revision {
  return {
    title: `Revision ${overrides.id}`,
    url: `https://example.com/pr/${overrides.id}`,
    headSHA: `sha-${overrides.id}`,
    headRef: `branch-${overrides.id}`,
    author: 'test-author',
    body: `Closes #${overrides.id}`,
    isDraft: false,
    workItemID: null,
    pipeline: null,
    reviewID: null,
    ...overrides,
  };
}
