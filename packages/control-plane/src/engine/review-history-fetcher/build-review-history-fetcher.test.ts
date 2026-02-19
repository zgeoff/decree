import { expect, test, vi } from 'vitest';
import type { RevisionFile } from '../github-provider/types.ts';
import type { ReviewHistory, Revision } from '../state-store/domain-type-stubs.ts';
import { buildReviewHistoryFetcher } from './build-review-history-fetcher.ts';

interface SetupTestResult {
  reader: {
    listRevisions: ReturnType<typeof vi.fn<() => Promise<Revision[]>>>;
    getRevision: ReturnType<typeof vi.fn<(id: string) => Promise<Revision | null>>>;
    getRevisionFiles: ReturnType<typeof vi.fn<(id: string) => Promise<RevisionFile[]>>>;
    getReviewHistory: ReturnType<typeof vi.fn<(revisionID: string) => Promise<ReviewHistory>>>;
  };
}

function setupTest(): SetupTestResult {
  const reader = {
    listRevisions: vi.fn<() => Promise<Revision[]>>().mockResolvedValue([]),
    getRevision: vi.fn<(id: string) => Promise<Revision | null>>().mockResolvedValue(null),
    getRevisionFiles: vi.fn<(id: string) => Promise<RevisionFile[]>>().mockResolvedValue([]),
    getReviewHistory: vi
      .fn<(revisionID: string) => Promise<ReviewHistory>>()
      .mockResolvedValue({ reviews: [], inlineComments: [] }),
  };

  return { reader };
}

test('it returns a function that fetches review history', () => {
  const { reader } = setupTest();

  const getReviewHistory = buildReviewHistoryFetcher(reader);

  expect(typeof getReviewHistory).toBe('function');
});

test('it delegates to the revision reader for review history', async () => {
  const { reader } = setupTest();
  const expectedHistory: ReviewHistory = {
    reviews: [{ author: 'alice', state: 'approved', body: 'Looks good' }],
    inlineComments: [{ path: 'src/foo.ts', line: 10, author: 'alice', body: 'Nit: rename this' }],
  };
  reader.getReviewHistory.mockResolvedValue(expectedHistory);

  const getReviewHistory = buildReviewHistoryFetcher(reader);
  const result = await getReviewHistory('123');

  expect(result).toStrictEqual(expectedHistory);
  expect(reader.getReviewHistory).toHaveBeenCalledWith('123');
});

test('it passes the revision ID to the reader', async () => {
  const { reader } = setupTest();

  const getReviewHistory = buildReviewHistoryFetcher(reader);
  await getReviewHistory('456');

  expect(reader.getReviewHistory).toHaveBeenCalledWith('456');
});
