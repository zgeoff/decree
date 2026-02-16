import { vi } from 'vitest';
import type { GitHubClient } from '../engine/github-client/types.ts';

export function createMockGitHubClient(): GitHubClient {
  return {
    apps: {
      getAuthenticated: vi.fn().mockResolvedValue({ data: { slug: '' } }),
    },
    issues: {
      get: vi.fn().mockResolvedValue({
        data: { number: 1, title: '', body: null, labels: [], created_at: '' },
      }),
      listForRepo: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({
        data: { number: 1, title: '', body: null, labels: [], created_at: '' },
      }),
      update: vi.fn().mockResolvedValue({
        data: { number: 1, title: '', body: null, labels: [], created_at: '' },
      }),
      listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
      addLabels: vi.fn().mockResolvedValue({ data: {} }),
      removeLabel: vi.fn().mockResolvedValue({ data: {} }),
      createComment: vi.fn().mockResolvedValue({ data: {} }),
    },
    pulls: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({
        data: {
          number: 1,
          title: '',
          changed_files: 0,
          html_url: '',
          user: null,
          head: { sha: '', ref: '' },
          body: null,
          draft: false,
        },
      }),
      listFiles: vi.fn().mockResolvedValue({ data: [] }),
      listReviews: vi.fn().mockResolvedValue({ data: [] }),
      listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({
        data: {
          number: 1,
          title: '',
          html_url: '',
          head: { sha: '', ref: '' },
          user: null,
          body: null,
          draft: false,
        },
      }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      createReview: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      dismissReview: vi.fn().mockResolvedValue({ data: {} }),
    },
    repos: {
      getCombinedStatusForRef: vi
        .fn()
        .mockResolvedValue({ data: { state: 'success', total_count: 0 } }),
      getContent: vi.fn().mockResolvedValue({ data: {} }),
    },
    checks: {
      listForRef: vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } }),
    },
    git: {
      getTree: vi.fn().mockResolvedValue({ data: { sha: '', tree: [] } }),
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: '' } } }),
      getBlob: vi.fn().mockResolvedValue({ data: { content: '', encoding: 'base64' } }),
      getCommit: vi.fn().mockResolvedValue({ data: { sha: '', tree: { sha: '' } } }),
      createBlob: vi.fn().mockResolvedValue({ data: { sha: '' } }),
      createTree: vi.fn().mockResolvedValue({ data: { sha: '' } }),
      createCommit: vi.fn().mockResolvedValue({ data: { sha: '' } }),
      createRef: vi.fn().mockResolvedValue({ data: {} }),
      updateRef: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
}
