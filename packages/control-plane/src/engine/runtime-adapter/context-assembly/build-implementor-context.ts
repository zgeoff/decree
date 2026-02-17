import type { RevisionFile } from '../../github-provider/types.ts';
import type { PipelineResult } from '../../state-store/types.ts';
import type { ImplementorStartParams, ReviewHistory } from '../types.ts';
import type { BuildImplementorContextDeps } from './types.ts';

/**
 * Resolves `ImplementorStartParams` into an enriched trigger prompt.
 *
 * Two tiers:
 * - No linked revision: prompt includes work item details only.
 * - Linked revision: prompt additionally includes revision files, CI status (on failure),
 *   and prior review history.
 */
export async function buildImplementorContext(
  params: ImplementorStartParams,
  deps: BuildImplementorContextDeps,
): Promise<string> {
  const state = deps.getState();
  const workItem = state.workItems.get(params.workItemID);

  if (workItem === undefined) {
    throw new Error(`Work item ${params.workItemID} not found in state`);
  }

  const body = await deps.workItemReader.getWorkItemBody(params.workItemID);

  const sections: string[] = [];
  sections.push(buildWorkItemSection(params.workItemID, workItem.title, body, workItem.status));

  if (workItem.linkedRevision !== null) {
    const revisionID = workItem.linkedRevision;
    const revision = state.revisions.get(revisionID);

    if (revision === undefined) {
      throw new Error(`Revision ${revisionID} not found in state`);
    }

    const [files, reviewHistory] = await Promise.all([
      deps.revisionReader.getRevisionFiles(revisionID),
      deps.getReviewHistory(revisionID),
    ]);

    sections.push(buildRevisionSection(revisionID, revision.title, files));

    const ciSection = buildCIStatusSection(revision.pipeline);
    if (ciSection !== null) {
      sections.push(ciSection);
    }

    const reviewsSection = buildReviewsSection(reviewHistory);
    if (reviewsSection !== null) {
      sections.push(reviewsSection);
    }

    const inlineCommentsSection = buildInlineCommentsSection(reviewHistory);
    if (inlineCommentsSection !== null) {
      sections.push(inlineCommentsSection);
    }
  }

  return sections.join('\n');
}

function buildWorkItemSection(
  workItemID: string,
  title: string,
  body: string,
  status: string,
): string {
  const lines: string[] = [];

  lines.push(`## Work Item #${workItemID} — ${title}`);
  lines.push('');
  lines.push(body);
  lines.push('');
  lines.push('### Status');
  lines.push(status);
  lines.push('');

  return lines.join('\n');
}

function buildRevisionSection(revisionID: string, title: string, files: RevisionFile[]): string {
  const lines: string[] = [];

  lines.push(`## Revision #${revisionID} — ${title}`);
  lines.push('');
  lines.push('### Changed Files');
  lines.push('');

  for (const file of files) {
    lines.push(buildFileEntry(file));
  }

  return lines.join('\n');
}

function buildFileEntry(file: RevisionFile): string {
  const lines: string[] = [];

  lines.push(`#### ${file.path} (${file.status})`);

  if (file.patch !== null) {
    lines.push('```');
    lines.push(file.patch);
    lines.push('```');
  }

  lines.push('');

  return lines.join('\n');
}

function buildCIStatusSection(pipeline: PipelineResult | null): string | null {
  if (pipeline === null || pipeline.status !== 'failure') {
    return null;
  }

  const lines: string[] = [];

  lines.push('### CI Status: FAILURE');
  lines.push('');
  lines.push(`${pipeline.reason}: ${pipeline.url}`);
  lines.push('');

  return lines.join('\n');
}

function buildReviewsSection(reviewHistory: ReviewHistory): string | null {
  if (reviewHistory.reviews.length === 0) {
    return null;
  }

  const lines: string[] = [];

  lines.push('### Prior Reviews');
  lines.push('');

  for (const review of reviewHistory.reviews) {
    lines.push(`#### Review by ${review.author} — ${review.state}`);
    lines.push('');
    lines.push(review.body);
    lines.push('');
  }

  return lines.join('\n');
}

function buildInlineCommentsSection(reviewHistory: ReviewHistory): string | null {
  if (reviewHistory.inlineComments.length === 0) {
    return null;
  }

  const lines: string[] = [];

  lines.push('### Prior Inline Comments');
  lines.push('');

  for (const comment of reviewHistory.inlineComments) {
    const lineRef = comment.line !== null ? comment.line : 'outdated';
    lines.push(`#### ${comment.path}:${lineRef} — ${comment.author}`);
    lines.push('');
    lines.push(comment.body);
    lines.push('');
  }

  return lines.join('\n');
}
