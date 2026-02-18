import type { DisplayStatus } from '../types.ts';

export type PlannerDisplayStatus = 'running' | 'idle';

export const STATUS_WEIGHT: Record<DisplayStatus, number> = {
  approved: 100,
  failed: 90,
  blocked: 80,
  'needs-refinement': 70,
  dispatch: 50,
  pending: 50,
  implementing: 50,
  reviewing: 50,
};

export const PRIORITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const ACTION_STATUSES: Set<DisplayStatus> = new Set([
  'approved',
  'failed',
  'blocked',
  'needs-refinement',
  'dispatch',
  'pending',
]);
