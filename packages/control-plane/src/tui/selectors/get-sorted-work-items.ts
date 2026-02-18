import type { EngineState } from '../../engine/state-store/types.ts';
import type { DisplayWorkItem, Section } from '../types.ts';
import { getDisplayWorkItems } from './get-display-work-items.ts';
import { PRIORITY_WEIGHT, STATUS_WEIGHT } from './types.ts';

const SECTION_ORDER: Record<Section, number> = {
  action: 0,
  agents: 1,
};

export function getSortedWorkItems(state: EngineState): DisplayWorkItem[] {
  const items = getDisplayWorkItems(state);
  items.sort(compareDisplayWorkItems);
  return items;
}

function compareDisplayWorkItems(a: DisplayWorkItem, b: DisplayWorkItem): number {
  // Section: ACTION first, then AGENTS
  const sectionDiff = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
  if (sectionDiff !== 0) {
    return sectionDiff;
  }

  // Status weight descending
  const aStatusWeight = STATUS_WEIGHT[a.displayStatus];
  const bStatusWeight = STATUS_WEIGHT[b.displayStatus];
  if (aStatusWeight !== bStatusWeight) {
    return bStatusWeight - aStatusWeight;
  }

  // Priority weight descending
  const aPriority = a.workItem.priority !== null ? (PRIORITY_WEIGHT[a.workItem.priority] ?? 0) : 0;
  const bPriority = b.workItem.priority !== null ? (PRIORITY_WEIGHT[b.workItem.priority] ?? 0) : 0;
  if (aPriority !== bPriority) {
    return bPriority - aPriority;
  }

  // Work item ID ascending (lexicographic)
  return a.workItem.id.localeCompare(b.workItem.id);
}
