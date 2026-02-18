import { expect, test, vi } from 'vitest';
import type { RevisionFile } from '../github-provider/types.ts';
import type { Revision } from '../state-store/domain-type-stubs.ts';
import { buildReviewHistoryFetcher } from './build-review-history-fetcher.ts';

interface SetupTestResult {
  reader: {
    listRevisions: ReturnType<typeof vi.fn<() => Promise<Revision[]>>>;
    getRevision: ReturnType<typeof vi.fn<(id: string) => Promise<Revision | null>>>;
    getRevisionFiles: ReturnType<typeof vi.fn<(id: string) => Promise<RevisionFile[]>>>;
  };
}

function setupTest(): SetupTestResult {
  const reader = {
    listRevisions: vi.fn<() => Promise<Revision[]>>().mockResolvedValue([]),
    getRevision: vi.fn<(id: string) => Promise<Revision | null>>().mockResolvedValue(null),
    getRevisionFiles: vi.fn<(id: string) => Promise<RevisionFile[]>>().mockResolvedValue([]),
  };

  return { reader };
}

test('it returns a function that fetches review history', () => {
  const { reader } = setupTest();

  const getReviewHistory = buildReviewHistoryFetcher(reader);

  expect(typeof getReviewHistory).toBe('function');
});

test('it returns empty review history until provider interface is extended', async () => {
  const { reader } = setupTest();
  const getReviewHistory = buildReviewHistoryFetcher(reader);

  const result = await getReviewHistory('123');

  expect(result).toStrictEqual({
    reviews: [],
    inlineComments: [],
  });
});

test('it accepts a revision ID parameter', async () => {
  const { reader } = setupTest();
  const getReviewHistory = buildReviewHistoryFetcher(reader);

  const result = await getReviewHistory('456');

  expect(result).toStrictEqual({
    reviews: [],
    inlineComments: [],
  });
});
