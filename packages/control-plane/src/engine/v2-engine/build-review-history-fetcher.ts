import type { RevisionProviderReader } from '../github-provider/types.ts';
import type { ReviewHistory } from '../runtime-adapter/types.ts';

export function buildReviewHistoryFetcher(
  _reader: RevisionProviderReader,
): (revisionID: string) => Promise<ReviewHistory> {
  return async (_revisionID: string): Promise<ReviewHistory> => {
    // TODO: Extend RevisionProviderReader interface with getReviewHistory method
    // For now, return empty review history as the interface doesn't expose
    // review/comment fetching capabilities
    return { reviews: [], inlineComments: [] };
  };
}
