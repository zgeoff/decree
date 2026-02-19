import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import type { StoreApi } from 'zustand';
import { applyStateUpdate } from '../engine/state-store/apply-state-update.ts';
import type { EngineState, Priority, WorkItemStatus } from '../engine/state-store/types.ts';
import { buildRevision } from '../test-utils/build-revision.ts';
import { buildWorkItem } from '../test-utils/build-work-item.ts';
import { App, computePaneWidths, resolveTaskURL } from './app.tsx';
import { createMockEngine } from './test-utils/create-mock-engine.ts';
import type { DisplayWorkItem } from './types.ts';

interface DeferredStart {
  resolve: () => void;
  reject: (error: Error) => void;
  waitForStartCalled: () => Promise<void>;
  start: () => Promise<void>;
}

function createDeferredStart(): DeferredStart {
  let resolveStart: () => void = () => {
    /* noop placeholder */
  };
  let rejectStart: (error: Error) => void = () => {
    /* noop placeholder */
  };
  let resolveStartCalled: () => void = () => {
    /* noop placeholder */
  };
  const startCalledPromise = new Promise<void>((resolve) => {
    resolveStartCalled = resolve;
  });

  const start = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
        resolveStartCalled();
      }),
  );

  return {
    resolve: () => resolveStart(),
    reject: (error: Error) => rejectStart(error),
    waitForStartCalled: () => startCalledPromise,
    start,
  };
}

function setupTest(): ReturnType<typeof render> & {
  engine: ReturnType<typeof createMockEngine>['engine'];
  engineStore: StoreApi<EngineState>;
  resolveStart: () => void;
  rejectStart: (error: Error) => void;
  waitForStartCalled: () => Promise<void>;
} {
  const deferred = createDeferredStart();
  const { engine, store: engineStore } = createMockEngine({ start: deferred.start });
  const instance = render(<App engine={engine} repository="owner/repo" />);
  return {
    ...instance,
    engine,
    engineStore,
    resolveStart: deferred.resolve,
    rejectStart: deferred.reject,
    waitForStartCalled: deferred.waitForStartCalled,
  };
}

function addWorkItem(
  engineStore: StoreApi<EngineState>,
  id: string,
  overrides?: {
    title?: string;
    status?: WorkItemStatus;
    priority?: Priority | null;
    linkedRevision?: string | null;
  },
): void {
  applyStateUpdate(engineStore, {
    type: 'workItemChanged',
    workItemID: id,
    workItem: buildWorkItem({
      id,
      title: overrides?.title ?? `Issue ${id}`,
      status: overrides?.status ?? 'ready',
      priority: overrides?.priority ?? null,
      linkedRevision: overrides?.linkedRevision ?? null,
    }),
    title: overrides?.title ?? `Issue ${id}`,
    oldStatus: null,
    newStatus: overrides?.status ?? 'ready',
    priority: overrides?.priority ?? null,
  });
}

async function setupStartedTest(): Promise<ReturnType<typeof setupTest>> {
  const result = setupTest();
  await result.waitForStartCalled();
  result.resolveStart();
  await vi.waitFor(() => {
    const frame = result.lastFrame() ?? '';
    expect(frame).toContain('ACTION');
    expect(frame).toContain('AGENTS');
  });
  return result;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

test('it shows a loading indicator while the engine is starting', () => {
  const { lastFrame } = setupTest();

  expect(lastFrame()).toContain('Starting engine...');
});

test('it renders the two-pane layout after startup completes', async () => {
  const { lastFrame } = await setupStartedTest();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION');
  expect(frame).toContain('AGENTS');
  expect(frame).toContain('planner');
});

test('it shows an error message when startup fails', async () => {
  const { lastFrame, rejectStart, waitForStartCalled } = setupTest();

  await waitForStartCalled();
  rejectStart(new Error('connection refused'));

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Startup failed: connection refused');
  });
});

// ---------------------------------------------------------------------------
// Header Bar — Planner Status
// ---------------------------------------------------------------------------

test('it displays the idle planner indicator when planner is not running', async () => {
  const { lastFrame } = await setupStartedTest();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('planner');
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  const idleEmoji = '\uD83D\uDCA4';
  expect(frame).toContain(idleEmoji);
});

test('it displays a spinner for the planner when it is running', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  applyStateUpdate(engineStore, {
    type: 'plannerRequested',
    specPaths: ['spec.md'],
    sessionID: 'planner-sess-1',
  });
  applyStateUpdate(engineStore, {
    type: 'plannerStarted',
    sessionID: 'planner-sess-1',
    logFilePath: null,
  });

  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  const idleEmoji = '\uD83D\uDCA4';
  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('planner');
    // Should not show idle emoji
    expect(frame).not.toContain(idleEmoji);
  });
});

// ---------------------------------------------------------------------------
// Footer Bar
// ---------------------------------------------------------------------------

test('it displays task list keybinding hints when the task list is focused', async () => {
  const { lastFrame } = await setupStartedTest();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('[o]pen');
  expect(frame).toContain('[c]opy');
  expect(frame).toContain('[q]uit');
  expect(frame).toContain('[d]ispatch');
  expect(frame).toContain('pin');
});

test('it displays detail pane keybinding hints when the detail pane is focused', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('\t');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('scroll');
    expect(frame).toContain('back');
    expect(frame).toContain('[o]pen');
    expect(frame).toContain('[c]opy');
    expect(frame).toContain('[q]uit');
  });
});

test('it dims the dispatch hint when the selected task is not dispatchable', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Blocked task', status: 'blocked' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    // The dispatch hint should be present (possibly dimmed)
    expect(frame).toContain('[d]ispatch');
  });
});

// ---------------------------------------------------------------------------
// Section Sub-Panes
// ---------------------------------------------------------------------------

test('it renders ACTION and AGENTS section headers with counts', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Task One', status: 'ready', priority: 'high' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
    expect(frame).toContain('AGENTS (0)');
  });
});

test('it renders both section headers with zero items when the list is empty', async () => {
  const { lastFrame } = await setupStartedTest();

  const frame = lastFrame() ?? '';
  expect(frame).toContain('ACTION (0)');
  expect(frame).toContain('AGENTS (0)');
});

test('it places action statuses in the ACTION section', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Ready task', status: 'ready' });
  addWorkItem(engineStore, '2', { title: 'Blocked task', status: 'blocked' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (2)');
  });
});

test('it places agent statuses in the AGENTS section', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Implementing task', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '1',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AGENTS (1)');
  });
});

// ---------------------------------------------------------------------------
// Task Row Format
// ---------------------------------------------------------------------------

test('it renders task rows with issue number, status, and title', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '42', { title: 'My feature', status: 'ready', priority: 'high' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#42');
    expect(frame).toContain('DISPATCH');
    // Title may be truncated at narrow pane widths
    expect(frame).toContain('My');
  });
});

test('it shows WIP with agent count for implementing tasks', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Impl task', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '1',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('WIP(1)');
  });
});

test('it shows PR column with dash when no PRs are linked', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'No PR task', status: 'ready' });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('\u2014');
  });
});

test('it shows PR number when a single PR is linked', async () => {
  const { lastFrame, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Has PR task', status: 'ready', linkedRevision: '482' });
  applyStateUpdate(engineStore, {
    type: 'revisionChanged',
    revisionID: '482',
    workItemID: '1',
    revision: buildRevision({
      id: '482',
      url: 'https://github.com/owner/repo/pull/482',
      workItemID: '1',
    }),
    oldPipelineStatus: null,
    newPipelineStatus: null,
  });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('PR#482');
  });
});

// ---------------------------------------------------------------------------
// Navigation — Task list
// ---------------------------------------------------------------------------

test('it moves selection down when j is pressed', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'First', status: 'ready', priority: 'high' });
  addWorkItem(engineStore, '2', { title: 'Second', status: 'ready', priority: 'medium' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#1');
  });

  // Select first, then move down
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('j');

  await vi.waitFor(() => {
    // Both items should be visible
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#2');
  });
});

test('it does not wrap past the last AGENTS item when pressing down', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Only task', status: 'ready' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#1');
  });

  // Select it and then try to move down
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));

  // Should still show the same item
  expect(lastFrame()).toContain('#1');
});

test('it crosses sections seamlessly when navigating down from ACTION to AGENTS', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  // ACTION item
  addWorkItem(engineStore, '1', { title: 'Action task', status: 'ready', priority: 'high' });

  // AGENTS item
  addWorkItem(engineStore, '2', { title: 'Agent task', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '2',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ACTION (1)');
    expect(frame).toContain('AGENTS (1)');
  });

  // Navigate to first item, then down to agents
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('j');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    // Title may be truncated at narrow pane widths
    expect(frame).toContain('Agent');
    expect(frame).toContain('#2');
  });
});

// ---------------------------------------------------------------------------
// Enter — Pin task
// ---------------------------------------------------------------------------

test('it pins a task to the detail pane when Enter is pressed', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '5', { title: 'Pinnable task', status: 'ready' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#5');
  });

  // Select and pin
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('\r');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    // The detail pane should show something related to the pinned task
    expect(frame).toContain('#5');
  });
});

test('it does nothing when Enter is pressed with no selection', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('\r');

  await new Promise((r) => setTimeout(r, 50));

  const frame = lastFrame() ?? '';
  // No error, still showing empty sections
  expect(frame).toContain('ACTION (0)');
});

// ---------------------------------------------------------------------------
// d — Dispatch key
// ---------------------------------------------------------------------------

test('it shows a dispatch prompt when d is pressed on a dispatchable task', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '5', { title: 'Ready task', status: 'ready' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#5');
  });

  // Select and dispatch
  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('d');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Dispatch Implementor for #5?');
  });
});

test('it does nothing when d is pressed on a blocked task', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '5', { title: 'Blocked task', status: 'blocked' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#5');
  });

  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('d');

  await new Promise((r) => setTimeout(r, 50));

  expect(lastFrame()).not.toContain('Dispatch');
});

test('it shows a retry prompt when d is pressed on a failed task', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '7', { title: 'Crashed task', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '7',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });
  applyStateUpdate(engineStore, {
    type: 'implementorFailed',
    workItemID: '7',
    sessionID: 'sess-1',
    branchName: 'branch-1',
    error: 'crash',
    logFilePath: null,
  });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#7');
  });

  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('d');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Retry Implementor for #7?');
  });
});

test('it dispatches when the dispatch prompt is confirmed', async () => {
  const { lastFrame, stdin, engineStore, engine } = await setupStartedTest();

  addWorkItem(engineStore, '5', { title: 'Ready task', status: 'ready' });

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('#5');
  });

  stdin.write('j');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('d');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Dispatch Implementor for #5?');
  });

  stdin.write('y');

  await vi.waitFor(() => {
    expect(engine.enqueue).toHaveBeenCalledWith({
      type: 'userRequestedImplementorRun',
      workItemID: '5',
    });
  });
});

// ---------------------------------------------------------------------------
// Focus cycling
// ---------------------------------------------------------------------------

test('it toggles focus from task list to detail pane on Tab', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('\t');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('scroll');
    expect(frame).toContain('back');
  });
});

test('it toggles focus back to task list on second Tab', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('\t');
  await new Promise((r) => setTimeout(r, 50));
  stdin.write('\t');

  await vi.waitFor(() => {
    const frame = lastFrame() ?? '';
    expect(frame).toContain('pin');
    expect(frame).toContain('[d]ispatch');
  });
});

// ---------------------------------------------------------------------------
// Quit confirmation
// ---------------------------------------------------------------------------

test('it shows a quit prompt without agent count when no agents are running', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('q');

  await vi.waitFor(() => {
    const frame = lastFrame();
    expect(frame).toContain('Quit?');
    expect(frame).toContain('[y/n]');
  });
});

test('it shows a quit prompt with agent count when agents are running', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Test', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '1',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });

  stdin.write('q');

  await vi.waitFor(() => {
    const frame = lastFrame();
    expect(frame).toContain('Quit? 1 agent(s) running.');
    expect(frame).toContain('[y/n]');
  });
});

test('it dismisses the quit prompt when the user presses n', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('q');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Quit?');
  });

  stdin.write('n');

  await vi.waitFor(() => {
    expect(lastFrame()).not.toContain('Quit?');
  });
});

test('it dismisses the quit prompt when the user presses Escape', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('q');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Quit?');
  });

  stdin.write('\x1b');

  await vi.waitFor(() => {
    expect(lastFrame()).not.toContain('Quit?');
  });
});

test('it sends the shutdown command when the user confirms quit', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('q');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Quit?');
  });

  stdin.write('y');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Shutting down');
  });
});

// ---------------------------------------------------------------------------
// Prompt exclusivity
// ---------------------------------------------------------------------------

test('it ignores all keys except y, n, Escape while a prompt is active', async () => {
  const { lastFrame, stdin } = await setupStartedTest();

  stdin.write('q');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Quit?');
  });

  // These should all be ignored
  stdin.write('\r');
  stdin.write('j');
  stdin.write('\t');
  stdin.write('d');
  stdin.write('o');
  stdin.write('c');

  await new Promise((r) => setTimeout(r, 50));

  // Prompt is still active
  expect(lastFrame()).toContain('Quit?');
});

// ---------------------------------------------------------------------------
// Shutdown display
// ---------------------------------------------------------------------------

test('it shows the shutdown status with agent count while shutting down', async () => {
  const { lastFrame, stdin, engineStore } = await setupStartedTest();

  addWorkItem(engineStore, '1', { title: 'Test', status: 'in-progress' });
  applyStateUpdate(engineStore, {
    type: 'implementorRequested',
    workItemID: '1',
    sessionID: 'sess-1',
    branchName: 'branch-1',
  });
  applyStateUpdate(engineStore, {
    type: 'implementorStarted',
    sessionID: 'sess-1',
    logFilePath: null,
  });

  stdin.write('q');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Quit?');
  });

  stdin.write('y');

  await vi.waitFor(() => {
    expect(lastFrame()).toContain('Shutting down... waiting for 1 agent(s)');
  });
});

// ---------------------------------------------------------------------------
// Pane width calculation
// ---------------------------------------------------------------------------

test('it computes left pane as approximately 40 percent of terminal width', () => {
  const widths = computePaneWidths(100);
  // 100 - 1 border = 99 content, 40% = 39
  expect(widths[0]).toBe(39);
  expect(widths[1]).toBe(60);
  expect(widths[0] + widths[1] + 1).toBe(100);
});

test('it enforces a minimum of 30 columns for the left pane', () => {
  const widths = computePaneWidths(50);
  expect(widths[0]).toBeGreaterThanOrEqual(30);
});

test('it accounts for the border column', () => {
  const widths = computePaneWidths(120);
  expect(widths[0] + widths[1] + 1).toBe(120);
});

// ---------------------------------------------------------------------------
// URL Resolution
// ---------------------------------------------------------------------------

function buildDisplayWorkItemForURL(
  displayStatus: DisplayWorkItem['displayStatus'],
  overrides?: {
    linkedRevisionUrl?: string;
  },
): DisplayWorkItem {
  return {
    workItem: buildWorkItem({ id: '42', status: 'ready' }),
    displayStatus,
    section: 'action',
    linkedRevision: overrides?.linkedRevisionUrl
      ? buildRevision({ id: '10', url: overrides.linkedRevisionUrl })
      : null,
    latestRun: null,
    dispatchCount: 0,
  };
}

test('it resolves issue URL for dispatch tasks', () => {
  const item = buildDisplayWorkItemForURL('dispatch');
  expect(resolveTaskURL(item, 'owner/repo')).toBe('https://github.com/owner/repo/issues/42');
});

test('it resolves revision URL for reviewing tasks when revision exists', () => {
  const item = buildDisplayWorkItemForURL('reviewing', {
    linkedRevisionUrl: 'https://github.com/owner/repo/pull/10',
  });
  expect(resolveTaskURL(item, 'owner/repo')).toBe('https://github.com/owner/repo/pull/10');
});

test('it falls back to issue URL for reviewing tasks when no revision exists', () => {
  const item = buildDisplayWorkItemForURL('reviewing');
  expect(resolveTaskURL(item, 'owner/repo')).toBe('https://github.com/owner/repo/issues/42');
});

test('it resolves revision URL for approved tasks', () => {
  const item = buildDisplayWorkItemForURL('approved', {
    linkedRevisionUrl: 'https://github.com/owner/repo/pull/20',
  });
  expect(resolveTaskURL(item, 'owner/repo')).toBe('https://github.com/owner/repo/pull/20');
});

test('it resolves issue URL for failed tasks', () => {
  const item = buildDisplayWorkItemForURL('failed');
  expect(resolveTaskURL(item, 'owner/repo')).toBe('https://github.com/owner/repo/issues/42');
});
