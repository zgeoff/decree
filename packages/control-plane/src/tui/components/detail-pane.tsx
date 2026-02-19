import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { match } from 'ts-pattern';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import type { AgentRun, EngineState } from '../../engine/state-store/types.ts';
import { getDisplayWorkItems } from '../selectors/get-display-work-items.ts';
import type {
  CachedDetail,
  DisplayStatus,
  DisplayWorkItem,
  TUIActions,
  TUILocalState,
} from '../types.ts';

export interface DetailPaneProps {
  engineStore: StoreApi<EngineState>;
  tuiStore: StoreApi<TUILocalState & TUIActions>;
  paneWidth: number;
  paneHeight: number;
}

type ContentView =
  | { view: 'none' }
  | { view: 'issueDetail'; displayItem: DisplayWorkItem; detail: CachedDetail | null }
  | { view: 'agentStream'; displayItem: DisplayWorkItem; lines: string[] }
  | { view: 'revisionSummary'; displayItem: DisplayWorkItem; detail: CachedDetail | null }
  | { view: 'crashDetail'; displayItem: DisplayWorkItem; latestRun: AgentRun | null };

const SCROLL_STEP = 1;
const ELLIPSIS = '\u2026';
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI/OSC escape sequences use control characters by definition
const ANSI_REGEX = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

export function DetailPane(props: DetailPaneProps): ReactNode {
  const pinnedWorkItem = useStore(props.tuiStore, (s) => s.pinnedWorkItem);
  const engineState = useStore(props.engineStore);
  const streamBuffers = useStore(props.tuiStore, (s) => s.streamBuffers);
  const detailCache = useStore(props.tuiStore, (s) => s.detailCache);
  const focusedPane = useStore(props.tuiStore, (s) => s.focusedPane);

  const displayItems = getDisplayWorkItems(engineState);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevChunkCountRef = useRef(0);

  const visibleRowCount = props.paneHeight;

  const displayItem =
    pinnedWorkItem !== null
      ? (displayItems.find((item) => item.workItem.id === pinnedWorkItem) ?? null)
      : null;

  const contentView = resolveContentView({
    displayItem,
    streamBuffers,
    detailCache,
  });

  const allLines = buildContentLines(contentView);
  const lineCount = allLines.length;

  const isStreaming = contentView.view === 'agentStream';
  const streamLines = isStreaming ? contentView.lines : undefined;
  const chunkCount = streamLines?.length ?? 0;

  const prevPinnedRef = useRef(pinnedWorkItem);
  const prevStatusRef = useRef<DisplayStatus | null>(displayItem?.displayStatus ?? null);

  useEffect(() => {
    const pinnedChanged = pinnedWorkItem !== prevPinnedRef.current;
    const currentStatus = displayItem?.displayStatus ?? null;
    const statusChanged = currentStatus !== prevStatusRef.current;

    prevPinnedRef.current = pinnedWorkItem;
    prevStatusRef.current = currentStatus;

    if (pinnedChanged || statusChanged) {
      setAutoScroll(true);
      prevChunkCountRef.current = 0;

      if (isStreaming) {
        setScrollOffset(Math.max(0, lineCount - visibleRowCount));
      } else {
        setScrollOffset(0);
      }
      return;
    }

    if (isStreaming && chunkCount > prevChunkCountRef.current && autoScroll) {
      setScrollOffset(Math.max(0, lineCount - visibleRowCount));
    }
    prevChunkCountRef.current = chunkCount;
  }, [
    pinnedWorkItem,
    displayItem?.displayStatus,
    chunkCount,
    autoScroll,
    isStreaming,
    lineCount,
    visibleRowCount,
  ]);

  useInput((input, key) => {
    if (focusedPane !== 'detailPane') {
      return;
    }

    const isUp = key.upArrow || input === 'k';
    const isDown = key.downArrow || input === 'j';

    if (isUp) {
      setScrollOffset((prev) => Math.max(0, prev - SCROLL_STEP));
      if (isStreaming) {
        setAutoScroll(false);
      }
    }
    if (isDown) {
      setScrollOffset((prev) => {
        const maxOffset = Math.max(0, lineCount - visibleRowCount);
        const next = Math.min(prev + SCROLL_STEP, maxOffset);
        if (isStreaming && next >= lineCount - visibleRowCount) {
          setAutoScroll(true);
        }
        return next;
      });
    }
  });

  const clampedOffset = Math.max(
    0,
    Math.min(scrollOffset, Math.max(0, lineCount - visibleRowCount)),
  );
  const windowedLines = allLines.slice(clampedOffset, clampedOffset + visibleRowCount);

  return (
    <Box flexDirection="column">
      {windowedLines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: content lines have no stable identity
        <Text key={clampedOffset + i}>{truncateLine(line, props.paneWidth)}</Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Content View Resolution
// ---------------------------------------------------------------------------

interface ResolveContentViewParams {
  displayItem: DisplayWorkItem | null;
  streamBuffers: Map<string, string[]>;
  detailCache: Map<string, CachedDetail>;
}

function resolveContentView(params: ResolveContentViewParams): ContentView {
  if (params.displayItem === null) {
    return { view: 'none' };
  }

  const displayItem = params.displayItem;

  return match(displayItem.displayStatus)
    .with('dispatch', 'pending', 'needs-refinement', 'blocked', (): ContentView => {
      const detail = params.detailCache.get(displayItem.workItem.id) ?? null;
      return { view: 'issueDetail', displayItem, detail };
    })
    .with('implementing', 'reviewing', (): ContentView => {
      const sessionID = displayItem.latestRun?.sessionID;
      const lines = sessionID ? (params.streamBuffers.get(sessionID) ?? []) : [];
      return { view: 'agentStream', displayItem, lines };
    })
    .with('approved', (): ContentView => {
      const detail = params.detailCache.get(displayItem.workItem.id) ?? null;
      return { view: 'revisionSummary', displayItem, detail };
    })
    .with(
      'failed',
      (): ContentView => ({ view: 'crashDetail', displayItem, latestRun: displayItem.latestRun }),
    )
    .exhaustive();
}

// ---------------------------------------------------------------------------
// Content Line Builders
// ---------------------------------------------------------------------------

function buildContentLines(contentView: ContentView): string[] {
  return match(contentView)
    .with({ view: 'none' }, () => buildNoTaskLines())
    .with({ view: 'issueDetail' }, (cv) => buildIssueDetailLines(cv.displayItem, cv.detail))
    .with({ view: 'agentStream' }, (cv) => buildAgentStreamLines(cv.displayItem, cv.lines))
    .with({ view: 'revisionSummary' }, (cv) => buildRevisionSummaryLines(cv.displayItem, cv.detail))
    .with({ view: 'crashDetail' }, (cv) => buildCrashDetailLines(cv.displayItem, cv.latestRun))
    .exhaustive();
}

function buildNoTaskLines(): string[] {
  return ['No task selected'];
}

function buildIssueDetailLines(
  displayItem: DisplayWorkItem,
  detail: CachedDetail | null,
): string[] {
  const lines: string[] = [`#${displayItem.workItem.id} ${displayItem.workItem.title}`];

  if (detail === null || detail.loading) {
    lines.push('Loading...');
    return lines;
  }

  if (detail.body !== null) {
    lines.push('');
    lines.push(...detail.body.split('\n'));
  }

  return lines;
}

function buildAgentStreamLines(displayItem: DisplayWorkItem, lines: string[]): string[] {
  const latestRun = displayItem.latestRun;
  const agentLabel = latestRun?.role === 'reviewer' ? 'Reviewer' : 'Implementor';
  return [`${agentLabel} output for #${displayItem.workItem.id}`, ...lines];
}

function buildRevisionSummaryLines(
  displayItem: DisplayWorkItem,
  detail: CachedDetail | null,
): string[] {
  const revision = displayItem.linkedRevision;
  if (revision === null) {
    return [`#${displayItem.workItem.id} ${displayItem.workItem.title}`, 'No linked revision'];
  }

  const lines: string[] = [`PR ${revision.id}: ${revision.title}`];

  if (detail !== null && !detail.loading && detail.revisionFiles !== null) {
    lines.push(`Changed files: ${detail.revisionFiles.length}`);
    for (const file of detail.revisionFiles) {
      lines.push(`  ${file.status} ${file.path}`);
    }
  } else {
    lines.push('Loading...');
  }

  const pipeline = revision.pipeline;
  if (pipeline !== null) {
    lines.push(`CI: ${pipeline.status}`);
    if (pipeline.status === 'failure' && pipeline.reason !== null) {
      lines.push(`  ${pipeline.reason}`);
    }
  }

  return lines;
}

function buildCrashDetailLines(
  _displayItem: DisplayWorkItem,
  latestRun: AgentRun | null,
): string[] {
  if (latestRun === null) {
    return ['Crash information unavailable', 'Press [d] to retry'];
  }

  const agentLabel = latestRun.role === 'reviewer' ? 'Reviewer' : 'Implementor';
  const lines: string[] = [`Agent: ${agentLabel}`];

  lines.push(`Session: ${latestRun.sessionID}`);

  if (latestRun.role !== 'planner' && 'branchName' in latestRun) {
    lines.push(`Branch: ${latestRun.branchName}`);
  }

  if (latestRun.logFilePath !== null) {
    lines.push(`Log: ${buildOSC8Link(`file://${latestRun.logFilePath}`, latestRun.logFilePath)}`);
  }

  lines.push('Press [d] to retry');
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateLine(line: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  const visualWidth = stripAnsi(line).length;
  if (visualWidth <= maxWidth) {
    return line;
  }
  if (maxWidth === 1) {
    return ELLIPSIS;
  }
  return stripAndTruncate(line, maxWidth - 1) + ELLIPSIS;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function stripAndTruncate(text: string, maxVisibleChars: number): string {
  let visibleCount = 0;
  let i = 0;
  while (i < text.length && visibleCount < maxVisibleChars) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i);
      if (end !== -1) {
        i = end + 1;
      } else {
        visibleCount += 1;
        i += 1;
      }
    } else if (text[i] === '\x1b' && text[i + 1] === ']') {
      const end = text.indexOf('\x07', i);
      if (end !== -1) {
        i = end + 1;
      } else {
        visibleCount += 1;
        i += 1;
      }
    } else {
      visibleCount += 1;
      i += 1;
    }
  }
  return text.slice(0, i);
}

function buildOSC8Link(url: string, displayText: string): string {
  return `\x1b]8;;${url}\x07${displayText}\x1b]8;;\x07`;
}
