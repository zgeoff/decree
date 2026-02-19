import type { RevisionFile } from '../../github-provider/types.ts';
import type { EngineState } from '../../state-store/types.ts';
import type {
  ReviewerStartParams,
  ReviewInlineComment,
  ReviewSubmission,
  RuntimeAdapterDeps,
} from '../types.ts';

interface BuildReviewerContextConfig {
  params: ReviewerStartParams;
  getState: () => EngineState;
  deps: RuntimeAdapterDeps;
}

export async function buildReviewerContext(config: BuildReviewerContextConfig): Promise<string> {
  const workItemID = config.params.workItemID;
  const revisionID = config.params.revisionID;

  const state = config.getState();
  const workItem = state.workItems.get(workItemID);

  if (workItem === undefined) {
    throw new Error(`Work item ${workItemID} not found in state`);
  }

  const revision = state.revisions.get(revisionID);

  if (revision === undefined) {
    throw new Error(`Revision ${revisionID} not found in state`);
  }

  const [body, files, reviewHistory] = await Promise.all([
    config.deps.workItemReader.getWorkItemBody(workItemID),
    config.deps.revisionReader.getRevisionFiles(revisionID),
    config.deps.getReviewHistory(revisionID),
  ]);

  const sections: string[] = [];

  sections.push(buildWorkItemSection(workItemID, workItem.title, body, workItem.status));
  sections.push(buildRevisionSection(revisionID, revision.title, files));

  const reviewsSection = buildReviewsSection(reviewHistory.reviews);
  if (reviewsSection !== null) {
    sections.push(reviewsSection);
  }

  const commentsSection = buildInlineCommentsSection(reviewHistory.inlineComments);
  if (commentsSection !== null) {
    sections.push(commentsSection);
  }

  return sections.join('\n\n');
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

function buildReviewsSection(reviews: ReviewSubmission[]): string | null {
  if (reviews.length === 0) {
    return null;
  }

  const lines: string[] = [];

  lines.push('### Prior Reviews');
  lines.push('');

  for (const review of reviews) {
    lines.push(`#### Review by ${review.author} — ${review.state}`);
    lines.push('');
    lines.push(review.body);
    lines.push('');
  }

  return lines.join('\n');
}

function buildInlineCommentsSection(comments: ReviewInlineComment[]): string | null {
  if (comments.length === 0) {
    return null;
  }

  const lines: string[] = [];

  lines.push('### Prior Inline Comments');
  lines.push('');

  for (const comment of comments) {
    const lineRef = comment.line !== null ? comment.line : 'outdated';
    lines.push(`#### ${comment.path}:${lineRef} — ${comment.author}`);
    lines.push('');
    lines.push(comment.body);
    lines.push('');
  }

  return lines.join('\n');
}
