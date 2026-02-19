import { spawn } from 'node:child_process';
import process from 'node:process';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { match } from 'ts-pattern';
import { useStore } from 'zustand';
import type { Engine } from '../engine/v2-engine/types.ts';
import { ConfirmationPrompt } from './components/confirmation-prompt.tsx';
import { DetailPane } from './components/detail-pane.tsx';
import { computeSectionCapacities, getVisibleTasks, IssueList } from './components/issue-list.tsx';
import { useEngine } from './hooks.ts';
import { getDisplayWorkItems } from './selectors/get-display-work-items.ts';
import { getPlannerDisplayStatus } from './selectors/get-planner-display-status.ts';
import { getRunningAgentCount } from './selectors/get-running-agent-count.ts';
import { getSortedWorkItems } from './selectors/get-sorted-work-items.ts';
import type { DisplayStatus, DisplayWorkItem } from './types.ts';

export interface AppProps {
  engine: Engine;
  repository: string;
}

type FocusedPane = 'workItemList' | 'detailPane';

type PromptState =
  | { type: 'none' }
  | { type: 'quit' }
  | { type: 'dispatch'; workItemID: string }
  | { type: 'retry'; workItemID: string; agentRole: 'implementor' | 'reviewer' };

const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;
const LEFT_PANE_RATIO = 0.4;
const LEFT_PANE_MIN_COLS = 30;
const BORDER_COLUMNS = 1;
const HEADER_ROWS = 1;
const FOOTER_ROWS = 1;
const SPINNER_FRAMES: readonly string[] = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];
const SPINNER_INTERVAL_MS = 80;

const DISPATCHABLE_STATUSES: ReadonlySet<DisplayStatus> = new Set(['dispatch', 'failed']);

export function App(props: AppProps): ReactNode {
  const tuiStore = useEngine({ engine: props.engine });
  const [started, setStarted] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState>({ type: 'none' });
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Engine state (subscribe to raw state, derive in render)
  const engineState = useStore(props.engine.store);
  const runningAgentCount = getRunningAgentCount(engineState);
  const plannerStatus = getPlannerDisplayStatus(engineState);
  const sortedWorkItems = getSortedWorkItems(engineState);
  const displayWorkItems = getDisplayWorkItems(engineState);

  // TUI state
  const focusedPane = useStore(tuiStore, (s) => s.focusedPane);
  const shuttingDown = useStore(tuiStore, (s) => s.shuttingDown);
  const cycleFocus = useStore(tuiStore, (s) => s.cycleFocus);
  const shutdown = useStore(tuiStore, (s) => s.shutdown);
  const selectedWorkItem = useStore(tuiStore, (s) => s.selectedWorkItem);
  const pinnedWorkItem = useStore(tuiStore, (s) => s.pinnedWorkItem);
  const selectWorkItem = useStore(tuiStore, (s) => s.selectWorkItem);
  const pinWorkItem = useStore(tuiStore, (s) => s.pinWorkItem);
  const dispatchImplementor = useStore(tuiStore, (s) => s.dispatchImplementor);

  const { exit } = useApp();
  const { stdout } = useStdout();

  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const terminalHeight = stdout?.rows ?? DEFAULT_TERMINAL_HEIGHT;
  const paneWidths = computePaneWidths(terminalWidth);
  const contentHeight = terminalHeight - HEADER_ROWS - FOOTER_ROWS;

  const { actionCapacity, agentsCapacity } = computeSectionCapacities(contentHeight);
  const visibleTasks = getVisibleTasks(sortedWorkItems, actionCapacity, agentsCapacity);

  const selectedItem =
    selectedWorkItem !== null
      ? (displayWorkItems.find((item) => item.workItem.id === selectedWorkItem) ?? null)
      : null;
  const pinnedItem =
    pinnedWorkItem !== null
      ? (displayWorkItems.find((item) => item.workItem.id === pinnedWorkItem) ?? null)
      : null;

  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const focusedPaneRef = useRef(focusedPane);
  focusedPaneRef.current = focusedPane;

  const startupErrorRef = useRef(startupError);
  startupErrorRef.current = startupError;

  // Planner spinner animation
  useEffect(() => {
    if (plannerStatus !== 'running') {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [plannerStatus]);

  useEffect(() => {
    props.engine
      .start()
      .then(() => {
        setStarted(true);
      })
      .catch((error) => {
        setStartupError(error instanceof Error ? error.message : String(error));
      });
  }, [props.engine]);

  useEffect(() => {
    if (!shuttingDown) {
      return;
    }
    if (runningAgentCount === 0) {
      exit();
    }
  }, [shuttingDown, runningAgentCount, exit]);

  const handleOpenURL = useCallback(
    (item: DisplayWorkItem | null) => {
      if (!item) {
        return;
      }
      const url = resolveTaskURL(item, props.repository);
      if (url) {
        openUrl(url);
      }
    },
    [props.repository],
  );

  const handleCopyURL = useCallback(
    (item: DisplayWorkItem | null) => {
      if (!item) {
        return;
      }
      const url = resolveTaskURL(item, props.repository);
      if (url) {
        copyToClipboard(url);
      }
    },
    [props.repository],
  );

  // Refs for values used in useInput callback
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;

  const selectedWorkItemRef = useRef(selectedWorkItem);
  selectedWorkItemRef.current = selectedWorkItem;

  const selectedItemRef = useRef(selectedItem);
  selectedItemRef.current = selectedItem;

  const pinnedItemRef = useRef(pinnedItem);
  pinnedItemRef.current = pinnedItem;

  useInput((input, key) => {
    if (startupErrorRef.current) {
      exit();
      return;
    }

    const currentPrompt = promptRef.current;

    // Confirmation prompt active — only y/n/Escape
    if (currentPrompt.type !== 'none') {
      if (input === 'y') {
        confirmPrompt(currentPrompt);
        setPrompt({ type: 'none' });
        return;
      }
      if (input === 'n' || key.escape) {
        setPrompt({ type: 'none' });
        return;
      }
      return;
    }

    // Global keys
    if (key.tab) {
      cycleFocus();
      return;
    }
    if (input === 'q') {
      setPrompt({ type: 'quit' });
      return;
    }
    if (input === 'o') {
      const target = resolveTargetItem();
      handleOpenURL(target);
      return;
    }
    if (input === 'c') {
      const target = resolveTargetItem();
      handleCopyURL(target);
      return;
    }

    // Task list keys
    if (focusedPaneRef.current === 'workItemList') {
      handleTaskListInput(input, key);
    }
  });

  function resolveTargetItem(): DisplayWorkItem | null {
    if (focusedPaneRef.current === 'detailPane') {
      return pinnedItemRef.current;
    }
    return selectedItemRef.current;
  }

  function handleTaskListInput(
    input: string,
    key: { upArrow: boolean; downArrow: boolean; return: boolean },
  ): void {
    if (input === 'j' || key.downArrow) {
      navigateDown();
      return;
    }
    if (input === 'k' || key.upArrow) {
      navigateUp();
      return;
    }
    if (key.return) {
      const current = selectedWorkItemRef.current;
      if (current !== null) {
        pinWorkItem(current);
      }
      return;
    }
    if (input === 'd') {
      handleDispatchKey();
    }
  }

  function navigateDown(): void {
    const currentVisible = visibleTasksRef.current;
    const currentSelected = selectedWorkItemRef.current;
    if (currentVisible.length === 0) {
      return;
    }
    if (currentSelected === null) {
      const first = currentVisible[0];
      if (first) {
        selectWorkItem(first.workItem.id);
      }
      return;
    }
    const currentIndex = currentVisible.findIndex((item) => item.workItem.id === currentSelected);
    if (currentIndex < 0) {
      const first = currentVisible[0];
      if (first) {
        selectWorkItem(first.workItem.id);
      }
      return;
    }
    if (currentIndex < currentVisible.length - 1) {
      const next = currentVisible[currentIndex + 1];
      if (next) {
        selectWorkItem(next.workItem.id);
      }
    }
  }

  function navigateUp(): void {
    const currentVisible = visibleTasksRef.current;
    const currentSelected = selectedWorkItemRef.current;
    if (currentVisible.length === 0) {
      return;
    }
    if (currentSelected === null) {
      const first = currentVisible[0];
      if (first) {
        selectWorkItem(first.workItem.id);
      }
      return;
    }
    const currentIndex = currentVisible.findIndex((item) => item.workItem.id === currentSelected);
    if (currentIndex < 0) {
      const first = currentVisible[0];
      if (first) {
        selectWorkItem(first.workItem.id);
      }
      return;
    }
    if (currentIndex > 0) {
      const prev = currentVisible[currentIndex - 1];
      if (prev) {
        selectWorkItem(prev.workItem.id);
      }
    }
  }

  function handleDispatchKey(): void {
    const currentItem = selectedItemRef.current;
    if (!currentItem) {
      return;
    }
    if (!DISPATCHABLE_STATUSES.has(currentItem.displayStatus)) {
      return;
    }
    if (currentItem.displayStatus === 'failed' && currentItem.latestRun) {
      const agentRole =
        currentItem.latestRun.role === 'reviewer'
          ? ('reviewer' as const)
          : ('implementor' as const);
      setPrompt({ type: 'retry', workItemID: currentItem.workItem.id, agentRole });
      return;
    }
    setPrompt({ type: 'dispatch', workItemID: currentItem.workItem.id });
  }

  function confirmPrompt(currentPrompt: PromptState): void {
    match(currentPrompt)
      .with({ type: 'dispatch' }, (p) => {
        dispatchImplementor(p.workItemID);
      })
      .with({ type: 'retry' }, (p) => {
        dispatchImplementor(p.workItemID);
      })
      .with({ type: 'quit' }, () => {
        shutdown();
      })
      .with({ type: 'none' }, () => {
        /* no-op */
      })
      .exhaustive();
  }

  if (startupError) {
    return (
      <Box
        width={terminalWidth}
        height={terminalHeight}
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
      >
        <Text color="red">Startup failed: {startupError}</Text>
        <Text dimColor={true}>Press any key to exit.</Text>
      </Box>
    );
  }

  if (shuttingDown) {
    return (
      <Box
        width={terminalWidth}
        height={terminalHeight}
        alignItems="center"
        justifyContent="center"
      >
        <Text>
          {runningAgentCount > 0
            ? `Shutting down... waiting for ${runningAgentCount} agent(s)`
            : 'Shutting down...'}
        </Text>
      </Box>
    );
  }

  if (!started) {
    return (
      <Box
        width={terminalWidth}
        height={terminalHeight}
        alignItems="center"
        justifyContent="center"
      >
        <Text>Starting engine...</Text>
      </Box>
    );
  }

  const promptMessage = buildPromptMessage(prompt, runningAgentCount);
  const dispatchDimmed = !(selectedItem && DISPATCHABLE_STATUSES.has(selectedItem.displayStatus));

  return (
    <Box width={terminalWidth} height={terminalHeight} flexDirection="column">
      <HeaderBar
        plannerStatus={plannerStatus}
        spinnerFrame={spinnerFrame}
        terminalWidth={terminalWidth}
      />
      <Box flexDirection="row" height={contentHeight}>
        <Box width={paneWidths[0]} height={contentHeight} flexDirection="column">
          <IssueList
            engineStore={props.engine.store}
            tuiStore={tuiStore}
            paneWidth={paneWidths[0]}
            paneHeight={contentHeight}
          />
        </Box>
        <Text>│</Text>
        <Box width={paneWidths[1]} height={contentHeight} flexDirection="column">
          <DetailPane
            engineStore={props.engine.store}
            tuiStore={tuiStore}
            paneWidth={paneWidths[1]}
            paneHeight={contentHeight}
          />
        </Box>
      </Box>
      <FooterBar focusedPane={focusedPane} dispatchDimmed={dispatchDimmed} />
      {promptMessage !== null ? (
        <ConfirmationPrompt
          message={promptMessage}
          terminalWidth={terminalWidth}
          terminalHeight={terminalHeight}
        />
      ) : null}
    </Box>
  );
}

export function computePaneWidths(terminalWidth: number): readonly [number, number] {
  const contentWidth = terminalWidth - BORDER_COLUMNS;
  const leftWidth = Math.max(LEFT_PANE_MIN_COLS, Math.floor(contentWidth * LEFT_PANE_RATIO));
  const rightWidth = Math.max(0, contentWidth - leftWidth);
  return [leftWidth, rightWidth];
}

// ---------------------------------------------------------------------------
// Header Bar
// ---------------------------------------------------------------------------

interface HeaderBarProps {
  plannerStatus: 'idle' | 'running';
  spinnerFrame: number;
  terminalWidth: number;
}

function HeaderBar(props: HeaderBarProps): ReactNode {
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  const IDLE_EMOJI = '\uD83D\uDCA4';
  const indicator =
    props.plannerStatus === 'running'
      ? (SPINNER_FRAMES[props.spinnerFrame] ?? '\u280B')
      : IDLE_EMOJI;

  return (
    <Box width={props.terminalWidth} justifyContent="flex-end">
      <Text>planner {indicator}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Footer Bar
// ---------------------------------------------------------------------------

interface FooterBarProps {
  focusedPane: FocusedPane;
  dispatchDimmed: boolean;
}

function FooterBar(props: FooterBarProps): ReactNode {
  if (props.focusedPane === 'workItemList') {
    return (
      <Box>
        <Text>
          {'↑↓jk select    <enter> pin    '}
          <Text dimColor={props.dispatchDimmed}>[d]ispatch</Text>
          {'    '}[o]pen [c]opy [q]uit
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text>↑↓jk scroll {'<tab>'} back [o]pen [c]opy [q]uit</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// URL Resolution
// ---------------------------------------------------------------------------

export function resolveTaskURL(item: DisplayWorkItem, repository: string): string | null {
  const issueURL = `https://github.com/${repository}/issues/${item.workItem.id}`;
  const revisionURL = item.linkedRevision?.url ?? null;

  return match(item.displayStatus)
    .with('dispatch', 'pending', () => issueURL)
    .with('needs-refinement', () => issueURL)
    .with('blocked', () => issueURL)
    .with('failed', () => issueURL)
    .with('implementing', () => revisionURL ?? issueURL)
    .with('reviewing', () => revisionURL ?? issueURL)
    .with('approved', () => revisionURL ?? issueURL)
    .exhaustive();
}

// ---------------------------------------------------------------------------
// Prompt Messages
// ---------------------------------------------------------------------------

function buildPromptMessage(prompt: PromptState, runningAgentCount: number): string | null {
  return match(prompt)
    .with({ type: 'dispatch' }, (p) => `Dispatch Implementor for #${p.workItemID}?`)
    .with({ type: 'retry' }, (p) => {
      const label = p.agentRole === 'implementor' ? 'Implementor' : 'Reviewer';
      return `Retry ${label} for #${p.workItemID}?`;
    })
    .with({ type: 'quit' }, () => {
      if (runningAgentCount > 0) {
        return `Quit? ${runningAgentCount} agent(s) running.`;
      }
      return 'Quit?';
    })
    .with({ type: 'none' }, () => null)
    .exhaustive();
}

// ---------------------------------------------------------------------------
// System Interaction
// ---------------------------------------------------------------------------

function openUrl(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore' });
    return;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore' });
}

function copyToClipboard(text: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.write(text);
    child.stdin.end();
    return;
  }
  if (platform === 'win32') {
    const child = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.write(text);
    child.stdin.end();
    return;
  }
  const child = spawn('xclip', ['-selection', 'clipboard'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.write(text);
  child.stdin.end();
}
