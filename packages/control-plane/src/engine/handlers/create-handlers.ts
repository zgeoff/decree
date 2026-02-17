import { handleDependencyResolution } from './handle-dependency-resolution.ts';
import { handleImplementation } from './handle-implementation.ts';
import { handleOrphanedWorkItem } from './handle-orphaned-work-item.ts';
import { handlePlanning } from './handle-planning.ts';
import { handleReadiness } from './handle-readiness.ts';
import { handleReview } from './handle-review.ts';
import { handleUserDispatch } from './handle-user-dispatch.ts';
import type { Handler } from './types.ts';

export function createHandlers(): Handler[] {
  return [
    handlePlanning,
    handleReadiness,
    handleImplementation,
    handleReview,
    handleDependencyResolution,
    handleOrphanedWorkItem,
    handleUserDispatch,
  ];
}
