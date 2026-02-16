import { vi } from 'vitest';
import type { RevisionReaderOctokit } from '../readers/create-revision-reader.ts';
import type { SpecReaderOctokit } from '../readers/create-spec-reader.ts';
import type { WorkItemReaderOctokit } from '../readers/create-work-item-reader.ts';
import { buildCheckRun } from './build-check-run.ts';
import { buildCombinedStatus } from './build-combined-status.ts';
import { buildIssueData } from './build-issue-data.ts';
import { buildPRData } from './build-pr-data.ts';

export function buildWorkItemReaderOctokit(
  overrides?: Partial<WorkItemReaderOctokit>,
): WorkItemReaderOctokit {
  return {
    issues: {
      listForRepo: overrides?.issues?.listForRepo ?? vi.fn().mockResolvedValue({ data: [] }),
      get: overrides?.issues?.get ?? vi.fn().mockResolvedValue({ data: buildIssueData() }),
    },
    pulls: {
      list: overrides?.pulls?.list ?? vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

export function buildRevisionReaderOctokit(
  overrides?: Partial<RevisionReaderOctokit>,
): RevisionReaderOctokit {
  return {
    pulls: {
      list: overrides?.pulls?.list ?? vi.fn().mockResolvedValue({ data: [] }),
      get: overrides?.pulls?.get ?? vi.fn().mockResolvedValue({ data: buildPRData() }),
      listReviews: overrides?.pulls?.listReviews ?? vi.fn().mockResolvedValue({ data: [] }),
      listFiles: overrides?.pulls?.listFiles ?? vi.fn().mockResolvedValue({ data: [] }),
    },
    repos: {
      getCombinedStatusForRef:
        overrides?.repos?.getCombinedStatusForRef ??
        vi.fn().mockResolvedValue({ data: buildCombinedStatus('success', 1) }),
    },
    checks: {
      listForRef:
        overrides?.checks?.listForRef ??
        vi.fn().mockResolvedValue({
          data: { total_count: 1, check_runs: [buildCheckRun()] },
        }),
    },
  };
}

export function buildSpecReaderOctokit(overrides?: Partial<SpecReaderOctokit>): SpecReaderOctokit {
  return {
    git: {
      getTree:
        overrides?.git?.getTree ?? vi.fn().mockResolvedValue({ data: { sha: 'sha', tree: [] } }),
      getBlob:
        overrides?.git?.getBlob ??
        vi.fn().mockResolvedValue({ data: { content: '', encoding: 'base64' } }),
    },
    repos: {
      getContent:
        overrides?.repos?.getContent ?? vi.fn().mockResolvedValue({ data: { sha: 'sha' } }),
    },
  };
}
