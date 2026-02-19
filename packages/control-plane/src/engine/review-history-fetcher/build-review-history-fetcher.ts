import type { RevisionProviderReader } from '../github-provider/types.ts';
import type { ReviewHistory } from '../runtime-adapter/types.ts';

export function buildReviewHistoryFetcher(
  reader: RevisionProviderReader,
): (revisionID: string) => Promise<ReviewHistory> {
  return async (revisionID: string): Promise<ReviewHistory> => reader.getReviewHistory(revisionID);
}
