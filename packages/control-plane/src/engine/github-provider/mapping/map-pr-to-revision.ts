import type { PipelineResult, Revision } from '../../state-store/domain-type-stubs.ts';
import { matchClosingKeywords } from './match-closing-keywords.ts';

export interface GitHubPRInput {
  number: number;
  title: string;
  html_url: string;
  head: GitHubPRHead;
  user: GitHubPRUser | null;
  body: string | null;
  draft?: boolean;
}

export interface GitHubPRHead {
  sha: string;
  ref: string;
}

export interface GitHubPRUser {
  login: string;
}

export interface MapPROptions {
  pipeline: PipelineResult | null;
  reviewID: string | null;
}

export function mapPRToRevision(pr: GitHubPRInput, options: MapPROptions): Revision {
  const body = pr.body ?? '';
  const workItemID = matchClosingKeywords(body);

  return {
    id: String(pr.number),
    title: pr.title,
    url: pr.html_url,
    headSHA: pr.head.sha,
    headRef: pr.head.ref,
    author: pr.user?.login ?? '',
    body,
    isDraft: pr.draft ?? false,
    workItemID,
    pipeline: options.pipeline,
    reviewID: options.reviewID,
  };
}
