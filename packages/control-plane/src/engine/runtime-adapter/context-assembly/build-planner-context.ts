import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkProviderReader } from '../../github-provider/types.ts';
import type { EngineState } from '../../state-store/types.ts';
import type { PlannerStartParams } from '../types.ts';

// --- Types ---

/**
 * Dependencies for building the planner context prompt.
 */
export interface PlannerContextDeps {
  repoRoot: string;
  workItemReader: Pick<WorkProviderReader, 'getWorkItemBody'>;
  gitShowBlob: (blobSHA: string) => Promise<string>;
  createDiff: (oldContent: string, newContent: string, filePath: string) => string;
}

// --- Primary export ---

/**
 * Builds an enriched trigger prompt for the planner agent from `PlannerStartParams`.
 *
 * Resolves spec paths into full file content with change classification (added/modified)
 * and unified diffs, plus a listing of all existing work items.
 */
export async function buildPlannerContext(
  params: PlannerStartParams,
  getState: () => EngineState,
  deps: PlannerContextDeps,
): Promise<string> {
  const state = getState();
  const sections: string[] = [];

  // --- Changed Specs section ---
  const specSections = await buildSpecSections(params.specPaths, state, deps);
  sections.push('## Changed Specs');
  sections.push(...specSections);

  // --- Existing Work Items section ---
  const workItemSections = await buildWorkItemSections(state, deps);
  sections.push('## Existing Work Items');
  sections.push(...workItemSections);

  return sections.join('\n\n');
}

// --- Helpers ---

async function buildSpecSections(
  specPaths: string[],
  state: EngineState,
  deps: PlannerContextDeps,
): Promise<string[]> {
  return Promise.all(specPaths.map((filePath) => buildSpecSection(filePath, state, deps)));
}

async function buildSpecSection(
  filePath: string,
  state: EngineState,
  deps: PlannerContextDeps,
): Promise<string> {
  const fullPath = join(deps.repoRoot, filePath);
  const content = await readFile(fullPath, 'utf-8');
  const lastPlannedBlobSHA = state.lastPlannedSHAs.get(filePath);

  if (lastPlannedBlobSHA === undefined) {
    return `### ${filePath} (added)\n${content}`;
  }

  const oldContent = await deps.gitShowBlob(lastPlannedBlobSHA);
  const diff = deps.createDiff(oldContent, content, filePath);
  return `### ${filePath} (modified)\n${content}\n\n#### Diff\n${diff}`;
}

async function buildWorkItemSections(
  state: EngineState,
  deps: PlannerContextDeps,
): Promise<string[]> {
  const workItems = [...state.workItems.values()];
  return Promise.all(workItems.map((workItem) => buildWorkItemSection(workItem, deps)));
}

async function buildWorkItemSection(
  workItem: { id: string; title: string; status: string },
  deps: PlannerContextDeps,
): Promise<string> {
  const body = await deps.workItemReader.getWorkItemBody(workItem.id);
  return `### WorkItem #${workItem.id} \u2014 ${workItem.title}\nStatus: ${workItem.status}\n\n${body}`;
}
