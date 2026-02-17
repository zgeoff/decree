import { handleDependencyResolution } from './handle-dependency-resolution.ts';
import { handlePlanning } from './handle-planning.ts';
import { handleReadiness } from './handle-readiness.ts';
import type { Handler } from './types.ts';

export function createHandlers(): Handler[] {
  return [
    handlePlanning,
    handleReadiness,
    // TODO: handleImplementation — will be implemented by a subsequent task
    () => [],
    // TODO: handleReview — will be implemented by a subsequent task
    () => [],
    handleDependencyResolution,
    // TODO: handleOrphanedWorkItem — will be implemented by a subsequent task
    () => [],
    // TODO: handleUserDispatch — will be implemented by a subsequent task
    () => [],
  ];
}
