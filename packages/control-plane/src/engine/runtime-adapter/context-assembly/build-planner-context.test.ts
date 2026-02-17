import { vol } from 'memfs';
import { expect, test, vi } from 'vitest';
import type { WorkProviderReader } from '../../github-provider/types.ts';
import type { EngineState } from '../../state-store/types.ts';
import type { PlannerStartParams } from '../types.ts';
import { buildPlannerContext, type PlannerContextDeps } from './build-planner-context.ts';

function setupTest(overrides?: {
  specFiles?: Record<string, string>;
  workItems?: EngineState['workItems'];
  lastPlannedSHAs?: EngineState['lastPlannedSHAs'];
  workItemBodies?: Record<string, string>;
  gitShowResults?: Record<string, string>;
}): {
  params: PlannerStartParams;
  getState: () => EngineState;
  deps: PlannerContextDeps;
} {
  const specFiles = overrides?.specFiles ?? {};
  const workItemBodies = overrides?.workItemBodies ?? {};
  const gitShowResults = overrides?.gitShowResults ?? {};

  vol.fromJSON(
    Object.fromEntries(
      Object.entries(specFiles).map(([path, content]) => [`/repo/${path}`, content]),
    ),
    '/',
  );

  const workItems = overrides?.workItems ?? new Map();
  const lastPlannedSHAs = overrides?.lastPlannedSHAs ?? new Map();

  const getState = (): EngineState => ({
    workItems,
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs,
  });

  const workItemReader: Pick<WorkProviderReader, 'getWorkItemBody'> = {
    getWorkItemBody: vi.fn(async (id: string): Promise<string> => {
      const body = workItemBodies[id];
      if (body === undefined) {
        throw new Error(`Work item ${id} not found`);
      }
      return body;
    }),
  };

  const gitShowBlob = vi.fn(async (blobSHA: string): Promise<string> => {
    const content = gitShowResults[blobSHA];
    if (content === undefined) {
      throw new Error(`Blob ${blobSHA} not found`);
    }
    return content;
  });

  const createDiff = vi.fn(
    (_oldContent: string, _newContent: string, filePath: string): string =>
      `--- a/${filePath}\n+++ b/${filePath}\n@@ mock diff @@`,
  );

  const deps: PlannerContextDeps = {
    repoRoot: '/repo',
    workItemReader,
    gitShowBlob,
    createDiff,
  };

  const params: PlannerStartParams = {
    role: 'planner',
    specPaths: Object.keys(specFiles),
  };

  return { params, getState, deps };
}

test('it includes full content for every spec path', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/auth.md': '# Auth Spec\nContent here.',
      'docs/specs/billing.md': '# Billing Spec\nMore content.',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('# Auth Spec\nContent here.');
  expect(result).toContain('# Billing Spec\nMore content.');
});

test('it classifies specs with no entry in lastPlannedSHAs as added with no diff', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/new-feature.md': '# New Feature',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('### docs/specs/new-feature.md (added)');
  expect(result).not.toContain('#### Diff');
  expect(deps.gitShowBlob).not.toHaveBeenCalled();
});

test('it classifies specs with a different blobSHA as modified with a unified diff', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/existing.md': '# Updated Content',
    },
    lastPlannedSHAs: new Map([['docs/specs/existing.md', 'abc123']]),
    gitShowResults: {
      abc123: '# Original Content',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('### docs/specs/existing.md (modified)');
  expect(result).toContain('#### Diff');
  expect(deps.gitShowBlob).toHaveBeenCalledWith('abc123');
  expect(deps.createDiff).toHaveBeenCalledWith(
    '# Original Content',
    '# Updated Content',
    'docs/specs/existing.md',
  );
});

test('it includes a changed specs section followed by an existing work items section', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/feature.md': '# Feature',
    },
    workItems: new Map([
      [
        '1',
        {
          id: '1',
          title: 'Task One',
          status: 'pending' as const,
          priority: null,
          complexity: null,
          blockedBy: [],
          createdAt: '2026-02-01T00:00:00Z',
          linkedRevision: null,
        },
      ],
    ]),
    workItemBodies: {
      '1': 'Task one body content.',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  const specsIndex = result.indexOf('## Changed Specs');
  const workItemsIndex = result.indexOf('## Existing Work Items');

  expect(specsIndex).toBeGreaterThanOrEqual(0);
  expect(workItemsIndex).toBeGreaterThan(specsIndex);
});

test('it includes work item id, title, status, and body for each work item', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/feature.md': '# Feature',
    },
    workItems: new Map([
      [
        '42',
        {
          id: '42',
          title: 'Implement auth',
          status: 'in-progress' as const,
          priority: 'high' as const,
          complexity: 'medium' as const,
          blockedBy: [],
          createdAt: '2026-02-01T00:00:00Z',
          linkedRevision: null,
        },
      ],
      [
        '43',
        {
          id: '43',
          title: 'Add billing',
          status: 'pending' as const,
          priority: null,
          complexity: null,
          blockedBy: ['42'],
          createdAt: '2026-02-02T00:00:00Z',
          linkedRevision: null,
        },
      ],
    ]),
    workItemBodies: {
      '42': 'Implement the authentication module.',
      '43': 'Add billing support to the platform.',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('### WorkItem #42 \u2014 Implement auth');
  expect(result).toContain('Status: in-progress');
  expect(result).toContain('Implement the authentication module.');

  expect(result).toContain('### WorkItem #43 \u2014 Add billing');
  expect(result).toContain('Status: pending');
  expect(result).toContain('Add billing support to the platform.');
});

test('it fetches work item bodies via the work item reader', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/feature.md': '# Feature',
    },
    workItems: new Map([
      [
        '10',
        {
          id: '10',
          title: 'Task',
          status: 'ready' as const,
          priority: null,
          complexity: null,
          blockedBy: [],
          createdAt: '2026-02-01T00:00:00Z',
          linkedRevision: null,
        },
      ],
    ]),
    workItemBodies: {
      '10': 'Body of task 10.',
    },
  });

  await buildPlannerContext(params, getState, deps);

  expect(deps.workItemReader.getWorkItemBody).toHaveBeenCalledWith('10');
});

test('it throws when a spec file read fails', async () => {
  const { getState, deps } = setupTest({
    specFiles: {},
  });

  const params: PlannerStartParams = {
    role: 'planner',
    specPaths: ['docs/specs/nonexistent.md'],
  };

  await expect(buildPlannerContext(params, getState, deps)).rejects.toThrow();
});

test('it throws when a work item body fetch fails', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/feature.md': '# Feature',
    },
    workItems: new Map([
      [
        '99',
        {
          id: '99',
          title: 'Missing body',
          status: 'pending' as const,
          priority: null,
          complexity: null,
          blockedBy: [],
          createdAt: '2026-02-01T00:00:00Z',
          linkedRevision: null,
        },
      ],
    ]),
    workItemBodies: {},
  });

  await expect(buildPlannerContext(params, getState, deps)).rejects.toThrow(
    'Work item 99 not found',
  );
});

test('it handles mixed added and modified specs correctly', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/new.md': '# New Spec',
      'docs/specs/changed.md': '# Changed Spec v2',
    },
    lastPlannedSHAs: new Map([['docs/specs/changed.md', 'sha456']]),
    gitShowResults: {
      sha456: '# Changed Spec v1',
    },
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('### docs/specs/new.md (added)');
  expect(result).toContain('### docs/specs/changed.md (modified)');
  expect(result).toContain('#### Diff');
});

test('it produces a prompt with no work items section content when state has no work items', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/feature.md': '# Feature',
    },
    workItems: new Map(),
  });

  const result = await buildPlannerContext(params, getState, deps);

  expect(result).toContain('## Existing Work Items');
  expect(result).not.toContain('### WorkItem');
});

test('it throws when git show blob fails for a modified spec', async () => {
  const { params, getState, deps } = setupTest({
    specFiles: {
      'docs/specs/modified.md': '# Updated',
    },
    lastPlannedSHAs: new Map([['docs/specs/modified.md', 'bad-sha']]),
    gitShowResults: {},
  });

  await expect(buildPlannerContext(params, getState, deps)).rejects.toThrow(
    'Blob bad-sha not found',
  );
});
