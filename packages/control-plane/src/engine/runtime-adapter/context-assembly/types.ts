import type { RevisionProviderReader, WorkProviderReader } from '../../github-provider/types.ts';
import type { EngineState } from '../../state-store/types.ts';
import type { ReviewHistory } from '../types.ts';

/**
 * Dependencies for building implementor context.
 */
export interface BuildImplementorContextDeps {
  workItemReader: WorkProviderReader;
  revisionReader: RevisionProviderReader;
  getState: () => EngineState;
  getReviewHistory: (revisionID: string) => Promise<ReviewHistory>;
}
