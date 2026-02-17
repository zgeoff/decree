import { handlePlanning } from './handle-planning.ts';
import type { Handler } from './types.ts';

export function createHandlers(): Handler[] {
  return [
    handlePlanning,
    // TODO: handleReadiness — will be implemented by a subsequent task
    () => [],
    // TODO: handleImplementation — will be implemented by a subsequent task
    () => [],
    // TODO: handleReview — will be implemented by a subsequent task
    () => [],
    // TODO: handleDependencyResolution — will be implemented by a subsequent task
    () => [],
    // TODO: handleOrphanedWorkItem — will be implemented by a subsequent task
    () => [],
    // TODO: handleUserDispatch — will be implemented by a subsequent task
    () => [],
  ];
}
