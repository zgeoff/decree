import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { match } from 'ts-pattern';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import type { EngineState, PipelineStatus, Priority } from '../../engine/state-store/types.ts';
import { getActionCount } from '../selectors/get-action-count.ts';
import { getAgentSectionCount } from '../selectors/get-agent-section-count.ts';
import { getSortedWorkItems } from '../selectors/get-sorted-work-items.ts';
import type { DisplayStatus, DisplayWorkItem, TUIActions, TUILocalState } from '../types.ts';

export interface IssueListProps {
  engineStore: StoreApi<EngineState>;
  tuiStore: StoreApi<TUILocalState & TUIActions>;
  paneWidth: number;
  paneHeight: number;
}

interface SectionSlice {
  items: DisplayWorkItem[];
  capacity: number;
  total: number;
}

const ISSUE_COL_WIDTH = 6;
const PR_COL_WIDTH = 8;
const STATUS_COL_WIDTH = 10;
const ICON_COL_WIDTH = 2;
const COLUMN_GAPS = 4;
const FIXED_COLUMNS_WIDTH: number =
  ISSUE_COL_WIDTH + PR_COL_WIDTH + STATUS_COL_WIDTH + ICON_COL_WIDTH + COLUMN_GAPS;
const HORIZONTAL_PADDING = 1;

const SECTION_HEADER_ROWS = 1;
const MIN_SECTIONS = 2;

const ELLIPSIS = '\u2026';

const STATUS_DISPLAY: Record<DisplayStatus, string> = {
  approved: 'APPROVED',
  failed: 'FAILED',
  blocked: 'BLOCKED',
  'needs-refinement': 'REFINE',
  dispatch: 'DISPATCH',
  pending: 'PENDING',
  implementing: 'WIP',
  reviewing: 'REVIEW',
};

const STATUS_ICON: Record<DisplayStatus, string> = {
  approved: '\u2714',
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  failed: '\uD83D\uDCA5',
  blocked: '\u26D4',
  'needs-refinement': '\uD83D\uDCDD',
  dispatch: '\u25CF',
  pending: '\u25CB',
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  implementing: '\uD83E\uDD16',
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  reviewing: '\uD83D\uDD0E',
};

export function IssueList(props: IssueListProps): ReactNode {
  const engineState = useStore(props.engineStore);
  const selectedWorkItem = useStore(props.tuiStore, (s) => s.selectedWorkItem);

  const sortedWorkItems = getSortedWorkItems(engineState);
  const actionCount = getActionCount(engineState);
  const agentSectionCount = getAgentSectionCount(engineState);

  const actionItems = sortedWorkItems.filter((item) => item.section === 'action');
  const agentItems = sortedWorkItems.filter((item) => item.section === 'agents');

  const contentHeight = props.paneHeight;
  const actionPaneHeight = Math.ceil(contentHeight / MIN_SECTIONS);
  const agentsPaneHeight = Math.floor(contentHeight / MIN_SECTIONS);

  const actionCapacity = Math.max(0, actionPaneHeight - SECTION_HEADER_ROWS);
  const agentsCapacity = Math.max(0, agentsPaneHeight - SECTION_HEADER_ROWS);

  const actionSlice = buildSectionSlice(actionItems, actionCapacity, actionCount);
  const agentsSlice = buildSectionSlice(agentItems, agentsCapacity, agentSectionCount);

  const titleWidth = Math.max(0, props.paneWidth - FIXED_COLUMNS_WIDTH - HORIZONTAL_PADDING);

  return (
    <Box flexDirection="column" height={contentHeight}>
      <Box flexDirection="column" height={actionPaneHeight}>
        <SectionHeader label="ACTION" slice={actionSlice} />
        {actionSlice.items.map((item) => (
          <TaskRow
            key={item.workItem.id}
            item={item}
            selected={item.workItem.id === selectedWorkItem}
            titleWidth={titleWidth}
          />
        ))}
      </Box>
      <Box flexDirection="column" height={agentsPaneHeight}>
        <SectionHeader label="AGENTS" slice={agentsSlice} />
        {agentsSlice.items.map((item) => (
          <TaskRow
            key={item.workItem.id}
            item={item}
            selected={item.workItem.id === selectedWorkItem}
            titleWidth={titleWidth}
          />
        ))}
      </Box>
    </Box>
  );
}

export function getVisibleTasks(
  sortedItems: DisplayWorkItem[],
  actionCapacity: number,
  agentsCapacity: number,
): DisplayWorkItem[] {
  const actionItems = sortedItems.filter((item) => item.section === 'action');
  const agentItems = sortedItems.filter((item) => item.section === 'agents');
  return [...actionItems.slice(0, actionCapacity), ...agentItems.slice(0, agentsCapacity)];
}

export function computeSectionCapacities(paneHeight: number): {
  actionCapacity: number;
  agentsCapacity: number;
} {
  const actionPaneHeight = Math.ceil(paneHeight / MIN_SECTIONS);
  const agentsPaneHeight = Math.floor(paneHeight / MIN_SECTIONS);
  return {
    actionCapacity: Math.max(0, actionPaneHeight - SECTION_HEADER_ROWS),
    agentsCapacity: Math.max(0, agentsPaneHeight - SECTION_HEADER_ROWS),
  };
}

// ---------------------------------------------------------------------------
// Section Header
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  label: string;
  slice: SectionSlice;
}

function SectionHeader(props: SectionHeaderProps): ReactNode {
  const countDisplay =
    props.slice.items.length < props.slice.total
      ? `(${props.slice.items.length}/${props.slice.total})`
      : `(${props.slice.total})`;

  return (
    <Box paddingLeft={HORIZONTAL_PADDING}>
      <Text bold={true} dimColor={true}>
        {props.label} {countDisplay}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Task Row
// ---------------------------------------------------------------------------

interface TaskRowProps {
  item: DisplayWorkItem;
  selected: boolean;
  titleWidth: number;
}

function TaskRow(props: TaskRowProps): ReactNode {
  const issueCol = renderIssueColumn(props.item);
  const prCol = renderPRColumn(props.item);
  const statusCol = renderStatusColumn(props.item);
  const iconCol = renderIconColumn(props.item);
  const titleCol = truncateText(props.item.workItem.title, props.titleWidth);

  const priorityColor = getIssuePriorityColor(props.item.workItem.priority);
  const revisionColor = getRevisionPipelineColor(props.item);

  return (
    <Box paddingLeft={HORIZONTAL_PADDING}>
      <Text inverse={props.selected}>
        {renderColoredText(issueCol, priorityColor)} {renderColoredText(prCol, revisionColor)}{' '}
        {statusCol} {iconCol} {titleCol}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Column Renderers
// ---------------------------------------------------------------------------

function renderIssueColumn(item: DisplayWorkItem): string {
  const issueStr = `#${item.workItem.id}`;
  return padRight(issueStr, ISSUE_COL_WIDTH);
}

export function getIssuePriorityColor(priority: Priority | null): string | undefined {
  if (priority === null) {
    return;
  }
  return match(priority)
    .with('high', () => 'red')
    .with('medium', () => 'yellow')
    .with('low', () => 'dim')
    .exhaustive();
}

export function getRevisionPipelineColor(item: DisplayWorkItem): string | undefined {
  if (item.linkedRevision === null || item.linkedRevision.pipeline === null) {
    return;
  }
  return getPipelineStatusColor(item.linkedRevision.pipeline.status);
}

function getPipelineStatusColor(status: PipelineStatus): string {
  return match(status)
    .with('success', () => 'green')
    .with('failure', () => 'red')
    .with('pending', () => 'yellow')
    .exhaustive();
}

function renderPRColumn(item: DisplayWorkItem): string {
  if (item.linkedRevision === null) {
    return padRight('\u2014', PR_COL_WIDTH);
  }
  return padRight(`PR#${item.linkedRevision.id}`, PR_COL_WIDTH);
}

function renderStatusColumn(item: DisplayWorkItem): string {
  if (item.displayStatus === 'implementing') {
    return padRight(`WIP(${item.dispatchCount})`, STATUS_COL_WIDTH);
  }
  const display = STATUS_DISPLAY[item.displayStatus] ?? '';
  return padRight(display, STATUS_COL_WIDTH);
}

function renderIconColumn(item: DisplayWorkItem): string {
  const icon = STATUS_ICON[item.displayStatus] ?? '';
  return padRight(icon, ICON_COL_WIDTH);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSectionSlice(
  items: DisplayWorkItem[],
  capacity: number,
  total: number,
): SectionSlice {
  return {
    items: items.slice(0, capacity),
    capacity,
    total,
  };
}

function renderColoredText(text: string, color: string | undefined): ReactNode {
  if (color === undefined) {
    return <Text>{text}</Text>;
  }
  return <Text color={color}>{text}</Text>;
}

function padRight(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }
  return text + ' '.repeat(width - text.length);
}

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  if (text.length <= maxWidth) {
    return text;
  }
  if (maxWidth === 1) {
    return ELLIPSIS;
  }
  return text.slice(0, maxWidth - 1) + ELLIPSIS;
}
