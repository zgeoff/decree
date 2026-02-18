import type { EngineState } from '../../engine/state-store/types.ts';
import { getDisplayWorkItems } from './get-display-work-items.ts';

export function getActionCount(state: EngineState): number {
  const items = getDisplayWorkItems(state);
  let count = 0;
  for (const item of items) {
    if (item.section === 'action') {
      count += 1;
    }
  }
  return count;
}
