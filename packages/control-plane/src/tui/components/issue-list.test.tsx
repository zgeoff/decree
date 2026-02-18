import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import type { Revision, WorkItem } from '../../engine/state-store/types.ts';
import type { DisplayStatus, DisplayWorkItem } from '../types.ts';
import {
  computeSectionCapacities,
  getIssuePriorityColor,
  getPipelineStatusColor,
  getVisibleWorkItems,
  IssueList,
} from './issue-list.tsx';

function buildWorkItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Work item ${overrides.id}`,
    status: 'pending',
    priority: null,
    complexity: null,
    blockedBy: [],
    createdAt: '2026-02-01T00:00:00Z',
    linkedRevision: null,
    ...overrides,
  };
}

function buildRevision(overrides: Partial<Revision> & { id: string }): Revision {
  return {
    title: `Revision ${overrides.id}`,
    url: `https://github.com/owner/repo/pull/${overrides.id}`,
    headSHA: 'abc123',
    headRef: 'feature-branch',
    author: 'author',
    body: '',
    isDraft: false,
    workItemID: null,
    pipeline: null,
    reviewID: null,
    ...overrides,
  };
}

function buildDisplayWorkItem(
  overrides: Partial<DisplayWorkItem> & { workItem: WorkItem; displayStatus: DisplayStatus },
): DisplayWorkItem {
  const section = (
    ['approved', 'failed', 'blocked', 'needs-refinement', 'dispatch', 'pending'] as DisplayStatus[]
  ).includes(overrides.displayStatus)
    ? 'action'
    : 'agents';

  return {
    section,
    linkedRevision: null,
    latestRun: null,
    dispatchCount: 0,
    ...overrides,
  };
}

interface SetupTestConfig {
  items?: DisplayWorkItem[];
  selectedWorkItem?: string | null;
  actionCount?: number;
  agentSectionCount?: number;
  paneHeight?: number;
  paneWidth?: number;
}

function setupTest(config?: SetupTestConfig): ReturnType<typeof render> {
  const items = config?.items ?? [];
  const actionCount = config?.actionCount ?? items.filter((i) => i.section === 'action').length;
  const agentSectionCount =
    config?.agentSectionCount ?? items.filter((i) => i.section === 'agents').length;

  return render(
    <IssueList
      items={items}
      selectedWorkItem={config?.selectedWorkItem ?? null}
      actionCount={actionCount}
      agentSectionCount={agentSectionCount}
      paneWidth={config?.paneWidth ?? 60}
      paneHeight={config?.paneHeight ?? 20}
    />,
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

test('it shows the correct count in section headers', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'pending' }),
      displayStatus: 'pending',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '2', status: 'blocked' }),
      displayStatus: 'blocked',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (2)');
  expect(frame).toContain('AGENTS (0)');
});

test('it shows AGENTS count when agent items exist', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'in-progress' }),
      displayStatus: 'implementing',
      dispatchCount: 1,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (0)');
  expect(frame).toContain('AGENTS (1)');
});

// ---------------------------------------------------------------------------
// Row Format
// ---------------------------------------------------------------------------

test('it renders the work item ID in the row', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '42', title: 'My feature' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('#42');
});

test('it renders the DISPATCH status label for dispatch items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'ready' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('DISPATCH');
});

test('it renders PENDING status for pending items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'pending' }),
      displayStatus: 'pending',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('PENDING');
});

test('it renders APPROVED status for approved items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'approved' }),
      displayStatus: 'approved',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('APPROVED');
});

test('it renders FAILED status for failed items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1' }),
      displayStatus: 'failed',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('FAILED');
});

test('it renders BLOCKED status for blocked items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'blocked' }),
      displayStatus: 'blocked',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('BLOCKED');
});

test('it renders REFINE status for needs-refinement items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'needs-refinement' }),
      displayStatus: 'needs-refinement',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('REFINE');
});

test('it renders REVIEW status for reviewing items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'review' }),
      displayStatus: 'reviewing',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('REVIEW');
});

test('it renders WIP with dispatch count for implementing items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'in-progress' }),
      displayStatus: 'implementing',
      dispatchCount: 3,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('WIP(3)');
});

test('it renders the title in the row', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', title: 'Feature X' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('Feature X');
});

// ---------------------------------------------------------------------------
// Revision Column
// ---------------------------------------------------------------------------

test('it shows a dash when no revision is linked', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1' }),
      displayStatus: 'dispatch',
      linkedRevision: null,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('\u2014');
});

test('it shows revision ID when a revision is linked', () => {
  const revision = buildRevision({ id: '482' });
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', linkedRevision: '482' }),
      displayStatus: 'dispatch',
      linkedRevision: revision,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('PR#482');
});

// ---------------------------------------------------------------------------
// Section Assignment
// ---------------------------------------------------------------------------

test('it places dispatch items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'ready' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
  expect(frame).toContain('AGENTS (0)');
});

test('it places pending items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'pending' }),
      displayStatus: 'pending',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
});

test('it places blocked items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'blocked' }),
      displayStatus: 'blocked',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
});

test('it places needs-refinement items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'needs-refinement' }),
      displayStatus: 'needs-refinement',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
});

test('it places approved items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'approved' }),
      displayStatus: 'approved',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
});

test('it places failed items in the ACTION section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1' }),
      displayStatus: 'failed',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
});

test('it places implementing items in the AGENTS section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'in-progress' }),
      displayStatus: 'implementing',
      dispatchCount: 1,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('AGENTS (1)');
});

test('it places reviewing items in the AGENTS section', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'review' }),
      displayStatus: 'reviewing',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('AGENTS (1)');
});

// ---------------------------------------------------------------------------
// Overflow Indicator
// ---------------------------------------------------------------------------

test('it shows overflow indicator when items exceed capacity', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', priority: 'high' }),
      displayStatus: 'dispatch',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '2', priority: 'medium' }),
      displayStatus: 'pending',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '3', priority: 'low' }),
      displayStatus: 'blocked',
    }),
  ];

  // With paneHeight 4: ACTION gets ceil(4/2)=2 rows, 1 header = 1 capacity
  const { lastFrame } = setupTest({ items, paneHeight: 4, actionCount: 3 });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1/3)');
});

// ---------------------------------------------------------------------------
// Selection highlight
// ---------------------------------------------------------------------------

test('it highlights the selected work item row', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', title: 'Selected task' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items, selectedWorkItem: '1' });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('Selected task');
});

test('it does not crash when selected work item is not in the list', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', title: 'Only task' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items, selectedWorkItem: '999' });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('Only task');
});

// ---------------------------------------------------------------------------
// Exported helpers: priority colors
// ---------------------------------------------------------------------------

test('it returns the correct priority color', () => {
  expect(getIssuePriorityColor('high')).toBe('red');
  expect(getIssuePriorityColor('medium')).toBe('yellow');
  expect(getIssuePriorityColor('low')).toBe('dim');
  expect(getIssuePriorityColor(null)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Exported helpers: pipeline status colors
// ---------------------------------------------------------------------------

test('it returns the correct pipeline status color', () => {
  expect(getPipelineStatusColor('failure')).toBe('red');
  expect(getPipelineStatusColor('pending')).toBe('dim');
  expect(getPipelineStatusColor('success')).toBe('green');
  expect(getPipelineStatusColor(null)).toBe('dim');
});

// ---------------------------------------------------------------------------
// Exported helpers: section capacities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exported helpers: visible work items
// ---------------------------------------------------------------------------

test('it computes visible work items respecting section capacities', () => {
  const items: DisplayWorkItem[] = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1' }),
      displayStatus: 'dispatch',
      section: 'action',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '2' }),
      displayStatus: 'pending',
      section: 'action',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '3' }),
      displayStatus: 'blocked',
      section: 'action',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '4' }),
      displayStatus: 'implementing',
      section: 'agents',
      dispatchCount: 1,
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '5' }),
      displayStatus: 'reviewing',
      section: 'agents',
    }),
  ];

  const result = getVisibleWorkItems(items, 2, 1);
  expect(result).toHaveLength(3);
  expect(result[0]?.workItem.id).toBe('1');
  expect(result[1]?.workItem.id).toBe('2');
  expect(result[2]?.workItem.id).toBe('4');
});

// ---------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------

test('it renders the approved icon for approved items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'approved' }),
      displayStatus: 'approved',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('\u2714');
});

test('it renders the dispatch icon for dispatch items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'ready' }),
      displayStatus: 'dispatch',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('\u25CF');
});

test('it renders the pending icon for pending items', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', status: 'pending' }),
      displayStatus: 'pending',
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('\u25CC');
});

// ---------------------------------------------------------------------------
// Mixed sections render together
// ---------------------------------------------------------------------------

test('it renders both action and agent items in their respective sections', () => {
  const items = [
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '1', title: 'Ready item' }),
      displayStatus: 'dispatch',
    }),
    buildDisplayWorkItem({
      workItem: buildWorkItem({ id: '2', title: 'Implementing item' }),
      displayStatus: 'implementing',
      dispatchCount: 1,
    }),
  ];

  const { lastFrame } = setupTest({ items });

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (1)');
  expect(frame).toContain('AGENTS (1)');
  expect(frame).toContain('Ready item');
  expect(frame).toContain('Implementing item');
});
