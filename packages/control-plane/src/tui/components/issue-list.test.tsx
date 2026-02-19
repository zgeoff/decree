import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import type { StoreApi } from 'zustand';
import type { Logger } from '../../engine/create-logger.ts';
import { createLogger } from '../../engine/create-logger.ts';
import { applyStateUpdate } from '../../engine/state-store/apply-state-update.ts';
import type { EngineState, Priority, WorkItemStatus } from '../../engine/state-store/types.ts';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { createTUIStore } from '../store.ts';
import { createMockEngine } from '../test-utils/create-mock-engine.ts';
import type { DisplayWorkItem } from '../types.ts';
import {
  computeSectionCapacities,
  getIssuePriorityColor,
  getRevisionPipelineColor,
  getVisibleTasks,
  IssueList,
} from './issue-list.tsx';

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op writer for test logger
const testLogger: Logger = createLogger({ logLevel: 'error', writer: () => {} });

function setupTest(config?: { paneHeight?: number; paneWidth?: number }): ReturnType<
  typeof render
> & {
  engineStore: StoreApi<EngineState>;
  tuiStore: ReturnType<typeof createTUIStore>;
} {
  const { engine, store: engineStore } = createMockEngine();
  const tuiStore = createTUIStore({ engine });
  const paneHeight = config?.paneHeight ?? 20;
  const paneWidth = config?.paneWidth ?? 60;

  const instance = render(
    <IssueList
      engineStore={engineStore}
      tuiStore={tuiStore}
      paneWidth={paneWidth}
      paneHeight={paneHeight}
    />,
  );

  return { ...instance, engineStore, tuiStore };
}

function addWorkItem(
  engineStore: StoreApi<EngineState>,
  id: string,
  overrides?: {
    title?: string;
    status?: WorkItemStatus;
    priority?: Priority | null;
    createdAt?: string;
  },
): void {
  applyStateUpdate(
    engineStore,
    {
      type: 'workItemChanged',
      workItemID: id,
      workItem: buildWorkItem({
        id,
        title: overrides?.title ?? `Issue ${id}`,
        status: overrides?.status ?? 'pending',
        priority: overrides?.priority ?? null,
        createdAt: overrides?.createdAt ?? '2026-01-01T00:00:00Z',
      }),
      title: overrides?.title ?? `Issue ${id}`,
      oldStatus: null,
      newStatus: overrides?.status ?? 'pending',
      priority: overrides?.priority ?? null,
    },
    testLogger,
  );
}

// ---------------------------------------------------------------------------
// Section Headers
// ---------------------------------------------------------------------------

test('it renders ACTION and AGENTS section headers even when empty', () => {
  const { lastFrame } = setupTest();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (0)');
  expect(frame).toContain('AGENTS (0)');
});

test('it shows the correct count in section headers', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'ready' });
  addWorkItem(engineStore, '2', { status: 'blocked' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (2)');
    expect(frame).toContain('AGENTS (0)');
  });
});

test('it shows AGENTS count when agent tasks exist', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'in-progress' });
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorRequested',
      workItemID: '1',
      sessionID: 'sess-1',
      branchName: 'issue-1',
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorStarted',
      sessionID: 'sess-1',
      logFilePath: null,
    },
    testLogger,
  );

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (0)');
    expect(frame).toContain('AGENTS (1)');
  });
});

// ---------------------------------------------------------------------------
// Row Format
// ---------------------------------------------------------------------------

test('it renders the work item id in the row', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '42', { title: 'My feature' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#42');
  });
});

test('it renders the status label in the row', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'ready' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('DISPATCH');
  });
});

test('it renders PENDING status for pending tasks', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'pending' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('PENDING');
  });
});

test('it renders APPROVED status for approved tasks', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'approved' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('APPROVED');
  });
});

test('it renders FAILED status for crashed tasks', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'in-progress' });
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorRequested',
      workItemID: '1',
      sessionID: 'sess-1',
      branchName: 'issue-1',
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorStarted',
      sessionID: 'sess-1',
      logFilePath: null,
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorFailed',
      workItemID: '1',
      sessionID: 'sess-1',
      branchName: 'issue-1',
      reason: 'error',
      error: 'boom',
      logFilePath: null,
    },
    testLogger,
  );

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('FAILED');
  });
});

test('it renders WIP with dispatch count for implementing tasks', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'in-progress' });
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorRequested',
      workItemID: '1',
      sessionID: 'sess-1',
      branchName: 'issue-1',
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorStarted',
      sessionID: 'sess-1',
      logFilePath: null,
    },
    testLogger,
  );

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('WIP(1)');
  });
});

test('it renders the title in the row', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { title: 'Feature X' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Feature X');
  });
});

// ---------------------------------------------------------------------------
// PR Column
// ---------------------------------------------------------------------------

test('it shows a dash when no revision is linked', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('\u2014');
  });
});

test('it shows revision id when a revision is linked', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1');

  // Add a revision to the engine store
  applyStateUpdate(
    engineStore,
    {
      type: 'revisionChanged',
      revisionID: '482',
      workItemID: '1',
      revision: buildRevision({
        id: '482',
        workItemID: '1',
        url: 'https://github.com/owner/repo/pull/482',
      }),
      oldPipelineStatus: null,
      newPipelineStatus: 'pending',
    },
    testLogger,
  );

  // Link the work item to the revision
  const state = engineStore.getState();
  const workItem = state.workItems.get('1');
  if (workItem) {
    const updated = new Map(state.workItems);
    updated.set('1', { ...workItem, linkedRevision: '482' });
    engineStore.setState({ workItems: updated });
  }

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('PR#482');
  });
});

// ---------------------------------------------------------------------------
// Section Assignment
// ---------------------------------------------------------------------------

test('it places ready tasks in the ACTION section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'ready', title: 'Ready' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
    expect(frame).toContain('AGENTS (0)');
  });
});

test('it places pending tasks in the ACTION section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'pending' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
  });
});

test('it places blocked tasks in the ACTION section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'blocked' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
  });
});

test('it places needs-refinement tasks in the ACTION section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'needs-refinement' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
  });
});

test('it places approved tasks in the ACTION section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'approved' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
  });
});

test('it places implementing tasks in the AGENTS section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'in-progress' });
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorRequested',
      workItemID: '1',
      sessionID: 'sess-1',
      branchName: 'issue-1',
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'implementorStarted',
      sessionID: 'sess-1',
      logFilePath: null,
    },
    testLogger,
  );

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AGENTS (1)');
  });
});

test('it places reviewing tasks in the AGENTS section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'review' });
  applyStateUpdate(
    engineStore,
    {
      type: 'reviewerRequested',
      workItemID: '1',
      revisionID: 'rev-1',
      sessionID: 'sess-r-1',
    },
    testLogger,
  );
  applyStateUpdate(
    engineStore,
    {
      type: 'reviewerStarted',
      sessionID: 'sess-r-1',
      logFilePath: null,
    },
    testLogger,
  );

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AGENTS (1)');
  });
});

// ---------------------------------------------------------------------------
// Overflow Indicator
// ---------------------------------------------------------------------------

test('it shows overflow indicator when items exceed capacity', async () => {
  const { lastFrame, engineStore } = setupTest({ paneHeight: 4 });
  // With paneHeight 4: ACTION gets ceil(4/2)=2 rows, 1 header = 1 capacity
  // AGENTS gets floor(4/2)=2 rows, 1 header = 1 capacity

  addWorkItem(engineStore, '1', { status: 'ready', title: 'First', priority: 'high' });
  addWorkItem(engineStore, '2', { status: 'ready', title: 'Second', priority: 'medium' });
  addWorkItem(engineStore, '3', { status: 'ready', title: 'Third', priority: 'low' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    // ACTION should show (1/3) overflow
    expect(frame).toContain('ACTION (1/3)');
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

test('it sorts tasks by status weight within a section', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'ready', title: 'Ready', priority: 'medium' });
  addWorkItem(engineStore, '2', { status: 'approved', title: 'Approved', priority: 'medium' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    const approvedPos = frame.indexOf('Approved');
    const readyPos = frame.indexOf('Ready');
    expect(approvedPos).toBeLessThan(readyPos);
  });
});

test('it sorts tasks by priority within the same status weight', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '1', { status: 'ready', title: 'Low', priority: 'low' });
  addWorkItem(engineStore, '2', { status: 'ready', title: 'High', priority: 'high' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    const highPos = frame.indexOf('High');
    const lowPos = frame.indexOf('Low');
    expect(highPos).toBeLessThan(lowPos);
  });
});

test('it sorts tasks by work item id within the same priority', async () => {
  const { lastFrame, engineStore } = setupTest();

  addWorkItem(engineStore, '10', { status: 'ready', title: 'Higher', priority: 'medium' });
  addWorkItem(engineStore, '5', { status: 'ready', title: 'Lower', priority: 'medium' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    const lowerPos = frame.indexOf('Lower');
    const higherPos = frame.indexOf('Higher');
    // Lexicographic: '10' > '5' is false ('1' < '5'), so '10' comes first
    expect(higherPos).toBeLessThan(lowerPos);
  });
});

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

test('it returns the correct priority color', () => {
  expect(getIssuePriorityColor('high')).toBe('red');
  expect(getIssuePriorityColor('medium')).toBe('yellow');
  expect(getIssuePriorityColor('low')).toBe('dim');
  expect(getIssuePriorityColor(null)).toBeUndefined();
});

test('it returns the correct pipeline status color', () => {
  const makeItem = (
    pipeline: {
      status: 'pending' | 'success' | 'failure';
      url: string | null;
      reason: string | null;
    } | null,
  ): DisplayWorkItem => ({
    workItem: buildWorkItem({ id: '1' }),
    displayStatus: 'approved',
    section: 'action',
    linkedRevision: pipeline !== null ? buildRevision({ id: 'rev-1', pipeline }) : null,
    latestRun: null,
    dispatchCount: 0,
  });

  expect(getRevisionPipelineColor(makeItem({ status: 'success', url: null, reason: null }))).toBe(
    'green',
  );
  expect(getRevisionPipelineColor(makeItem({ status: 'failure', url: null, reason: null }))).toBe(
    'red',
  );
  expect(getRevisionPipelineColor(makeItem({ status: 'pending', url: null, reason: null }))).toBe(
    'yellow',
  );
  expect(getRevisionPipelineColor(makeItem(null))).toBeUndefined();
  expect(
    getRevisionPipelineColor({
      workItem: buildWorkItem({ id: '1' }),
      displayStatus: 'dispatch',
      section: 'action',
      linkedRevision: null,
      latestRun: null,
      dispatchCount: 0,
    }),
  ).toBeUndefined();
});

test('it computes section capacities correctly for even pane height', () => {
  const result = computeSectionCapacities(20);
  // ceil(20/2) = 10, floor(20/2) = 10
  // Each minus 1 for header
  expect(result.actionCapacity).toBe(9);
  expect(result.agentsCapacity).toBe(9);
});

test('it gives the extra row to ACTION when pane height is odd', () => {
  const result = computeSectionCapacities(21);
  // ceil(21/2) = 11 - 1 = 10
  // floor(21/2) = 10 - 1 = 9
  expect(result.actionCapacity).toBe(10);
  expect(result.agentsCapacity).toBe(9);
});

test('it computes visible tasks respecting section capacities', () => {
  const makeItem = (id: string, section: 'action' | 'agents'): DisplayWorkItem => ({
    workItem: buildWorkItem({ id }),
    displayStatus: section === 'action' ? 'dispatch' : 'implementing',
    section,
    linkedRevision: null,
    latestRun: null,
    dispatchCount: 0,
  });

  const sortedItems: DisplayWorkItem[] = [
    makeItem('1', 'action'),
    makeItem('2', 'action'),
    makeItem('3', 'action'),
    makeItem('4', 'agents'),
    makeItem('5', 'agents'),
  ];

  const result = getVisibleTasks(sortedItems, 2, 1);
  expect(result).toHaveLength(3);
  expect(result[0]?.workItem.id).toBe('1');
  expect(result[1]?.workItem.id).toBe('2');
  expect(result[2]?.workItem.id).toBe('4');
});

// ---------------------------------------------------------------------------
// Selection highlight
// ---------------------------------------------------------------------------

test('it highlights the selected task row', async () => {
  const { lastFrame, engineStore, tuiStore } = setupTest();

  addWorkItem(engineStore, '1', { title: 'Selected task' });
  tuiStore.getState().selectWorkItem('1');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Selected task');
  });
});
