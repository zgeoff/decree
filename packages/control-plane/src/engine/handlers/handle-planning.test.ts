import { expect, test } from 'vitest';
import { buildPlannerCompletedEvent } from '../../test-utils/build-planner-completed-event.ts';
import { buildSpec } from '../../test-utils/build-spec.ts';
import { buildSpecChangedEvent } from '../../test-utils/build-spec-changed-event.ts';
import type { EngineState, Spec } from '../state-store/types.ts';
import { handlePlanning } from './handle-planning.ts';

function buildState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
    ...overrides,
  };
}

function buildSpecsMap(specs: Spec[]): Map<string, Spec> {
  return new Map(specs.map((s) => [s.filePath, s]));
}

// --- SpecChanged tests ---

test('it returns no commands when the spec is not approved', () => {
  const event = buildSpecChangedEvent({ frontmatterStatus: 'draft' });
  const state = buildState();

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the approved spec blob SHA matches the last planned SHA', () => {
  const spec = buildSpec({ filePath: 'docs/specs/test.md', blobSHA: 'sha-1' });
  const event = buildSpecChangedEvent({
    filePath: 'docs/specs/test.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });
  const state = buildState({
    specs: buildSpecsMap([spec]),
    lastPlannedSHAs: new Map([['docs/specs/test.md', 'sha-1']]),
  });

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([]);
});

test('it emits a planner run request with all approved spec paths when an approved spec needs planning', () => {
  const specA = buildSpec({ filePath: 'docs/specs/a.md', blobSHA: 'sha-new' });
  const specB = buildSpec({ filePath: 'docs/specs/b.md', blobSHA: 'sha-2' });
  const draftSpec = buildSpec({
    filePath: 'docs/specs/draft.md',
    blobSHA: 'sha-3',
    frontmatterStatus: 'draft',
  });
  const event = buildSpecChangedEvent({
    filePath: 'docs/specs/a.md',
    blobSHA: 'sha-new',
    frontmatterStatus: 'approved',
  });
  const state = buildState({
    specs: buildSpecsMap([specA, specB, draftSpec]),
    lastPlannedSHAs: new Map([
      ['docs/specs/a.md', 'sha-old'],
      ['docs/specs/b.md', 'sha-2'],
    ]),
  });

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([
    {
      command: 'requestPlannerRun',
      specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    },
  ]);
});

// --- PlannerCompleted tests ---

test('it emits only apply planner result when no specs require planning after completion', () => {
  const spec = buildSpec({ filePath: 'docs/specs/a.md', blobSHA: 'sha-1' });
  const result = { role: 'planner' as const, create: [], close: [], update: [] };
  const event = buildPlannerCompletedEvent({ result });
  const state = buildState({
    specs: buildSpecsMap([spec]),
    lastPlannedSHAs: new Map([['docs/specs/a.md', 'sha-1']]),
  });

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([{ command: 'applyPlannerResult', result }]);
});

test('it emits both apply planner result and a new planner run request when specs changed during the run', () => {
  const specA = buildSpec({ filePath: 'docs/specs/a.md', blobSHA: 'sha-1' });
  const specB = buildSpec({ filePath: 'docs/specs/b.md', blobSHA: 'sha-changed' });
  const result = { role: 'planner' as const, create: [], close: [], update: [] };
  const event = buildPlannerCompletedEvent({ result });
  const state = buildState({
    specs: buildSpecsMap([specA, specB]),
    lastPlannedSHAs: new Map([
      ['docs/specs/a.md', 'sha-1'],
      ['docs/specs/b.md', 'sha-old'],
    ]),
  });

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([
    { command: 'applyPlannerResult', result },
    {
      command: 'requestPlannerRun',
      specPaths: ['docs/specs/a.md', 'docs/specs/b.md'],
    },
  ]);
});

// --- Other event types ---

test('it returns no commands for unrelated event types', () => {
  const event = {
    type: 'workItemChanged' as const,
    workItemID: 'wi-1',
    workItem: {
      id: 'wi-1',
      title: 'Test',
      status: 'pending' as const,
      priority: null,
      complexity: null,
      blockedBy: [],
      createdAt: '2026-01-01T00:00:00Z',
      linkedRevision: null,
    },
    title: 'Test',
    oldStatus: null,
    newStatus: 'pending' as const,
    priority: null,
  };
  const state = buildState();

  const commands = handlePlanning(event, state);

  expect(commands).toStrictEqual([]);
});
