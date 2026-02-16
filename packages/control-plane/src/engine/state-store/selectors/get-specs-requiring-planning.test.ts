import { expect, test } from 'vitest';
import type { EngineState, Spec } from '../types.ts';
import { getSpecsRequiringPlanning } from './get-specs-requiring-planning.ts';

function buildSpec(overrides: Partial<Spec> & { filePath: string }): Spec {
  return {
    blobSHA: 'sha-default',
    frontmatterStatus: 'approved',
    ...overrides,
  };
}

function setupTest(
  specs: Spec[] = [],
  lastPlannedSHAs: Map<string, string> = new Map(),
): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(specs.map((s) => [s.filePath, s])),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs,
  };
}

test('it returns approved specs with no entry in last planned SHAs', () => {
  const spec = buildSpec({ filePath: 'docs/specs/test.md', blobSHA: 'sha-1' });
  const state = setupTest([spec]);

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([spec]);
});

test('it returns approved specs whose blob SHA differs from the last planned SHA', () => {
  const spec = buildSpec({ filePath: 'docs/specs/test.md', blobSHA: 'sha-new' });
  const lastPlannedSHAs = new Map([['docs/specs/test.md', 'sha-old']]);
  const state = setupTest([spec], lastPlannedSHAs);

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([spec]);
});

test('it excludes approved specs whose blob SHA matches the last planned SHA', () => {
  const spec = buildSpec({ filePath: 'docs/specs/test.md', blobSHA: 'sha-1' });
  const lastPlannedSHAs = new Map([['docs/specs/test.md', 'sha-1']]);
  const state = setupTest([spec], lastPlannedSHAs);

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([]);
});

test('it excludes specs that are not in approved status', () => {
  const draft = buildSpec({ filePath: 'docs/specs/draft.md', frontmatterStatus: 'draft' });
  const deprecated = buildSpec({
    filePath: 'docs/specs/deprecated.md',
    frontmatterStatus: 'deprecated',
  });
  const state = setupTest([draft, deprecated]);

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([]);
});

test('it returns an empty array when no specs exist', () => {
  const state = setupTest();

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([]);
});

test('it returns only the specs that need planning from a mixed set', () => {
  const needsPlanning = buildSpec({ filePath: 'docs/specs/new.md', blobSHA: 'sha-new' });
  const alreadyPlanned = buildSpec({ filePath: 'docs/specs/planned.md', blobSHA: 'sha-1' });
  const draftSpec = buildSpec({
    filePath: 'docs/specs/draft.md',
    frontmatterStatus: 'draft',
    blobSHA: 'sha-draft',
  });
  const lastPlannedSHAs = new Map([['docs/specs/planned.md', 'sha-1']]);
  const state = setupTest([needsPlanning, alreadyPlanned, draftSpec], lastPlannedSHAs);

  const result = getSpecsRequiringPlanning(state);

  expect(result).toStrictEqual([needsPlanning]);
});
