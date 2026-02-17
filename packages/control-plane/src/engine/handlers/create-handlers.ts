import { handleDependencyResolution } from './handle-dependency-resolution.ts';
import { handleOrphanedWorkItem } from './handle-orphaned-work-item.ts';
import { handlePlanning } from './handle-planning.ts';
import { handleReadiness } from './handle-readiness.ts';
import { handleUserDispatch } from './handle-user-dispatch.ts';
import type { Handler } from './types.ts';

const STUB_HANDLER: Handler = () => [];

// Stubs for handlers implemented by other tasks
const handleImplementation: Handler = STUB_HANDLER;
const handleReview: Handler = STUB_HANDLER;

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
