import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { match } from 'ts-pattern';
import type { PipelineStatus, Priority, Revision } from '../../engine/state-store/types.ts';
import type { DisplayStatus, DisplayWorkItem } from '../types.ts';

export interface IssueListProps {
  items: DisplayWorkItem[];
  selectedWorkItem: string | null;
  actionCount: number;
  agentSectionCount: number;
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
  pending: '\u25CC',
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  implementing: '\uD83E\uDD16',
  // biome-ignore lint/security/noSecrets: emoji character, not a secret
  reviewing: '\uD83D\uDD0E',
};

export function IssueList(props: IssueListProps): ReactNode {
  const actionItems = props.items.filter((item) => item.section === 'action');
  const agentItems = props.items.filter((item) => item.section === 'agents');

  const contentHeight = props.paneHeight;
  const actionPaneHeight = Math.ceil(contentHeight / MIN_SECTIONS);
  const agentsPaneHeight = Math.floor(contentHeight / MIN_SECTIONS);

  const actionCapacity = Math.max(0, actionPaneHeight - SECTION_HEADER_ROWS);
  const agentsCapacity = Math.max(0, agentsPaneHeight - SECTION_HEADER_ROWS);

  const actionSlice = buildSectionSlice(actionItems, actionCapacity, props.actionCount);
  const agentsSlice = buildSectionSlice(agentItems, agentsCapacity, props.agentSectionCount);

  const titleWidth = Math.max(0, props.paneWidth - FIXED_COLUMNS_WIDTH - HORIZONTAL_PADDING);

  return (
    <Box flexDirection="column" height={contentHeight}>
      <Box flexDirection="column" height={actionPaneHeight}>
        <SectionHeader label="ACTION" slice={actionSlice} />
        {actionSlice.items.map((item) => (
          <WorkItemRow
            key={item.workItem.id}
            item={item}
            selected={item.workItem.id === props.selectedWorkItem}
            titleWidth={titleWidth}
          />
        ))}
      </Box>
      <Box flexDirection="column" height={agentsPaneHeight}>
        <SectionHeader label="AGENTS" slice={agentsSlice} />
        {agentsSlice.items.map((item) => (
          <WorkItemRow
            key={item.workItem.id}
            item={item}
            selected={item.workItem.id === props.selectedWorkItem}
            titleWidth={titleWidth}
          />
        ))}
      </Box>
    </Box>
  );
}

export function getVisibleWorkItems(
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
// Work Item Row
// ---------------------------------------------------------------------------

interface WorkItemRowProps {
  item: DisplayWorkItem;
  selected: boolean;
  titleWidth: number;
}

function WorkItemRow(props: WorkItemRowProps): ReactNode {
  const idText = padRight(`#${props.item.workItem.id}`, ISSUE_COL_WIDTH);
  const revText = renderRevisionColumn(props.item.linkedRevision);
  const statusText = renderStatusColumn(props.item);
  const iconText = padRight(STATUS_ICON[props.item.displayStatus] ?? '', ICON_COL_WIDTH);
  const titleText = truncateText(props.item.workItem.title, props.titleWidth);

  const idColorProps = buildPriorityColorProps(props.item.workItem.priority);
  const revColorProps = buildRevisionColorProps(props.item.linkedRevision);

  return (
    <Box paddingLeft={HORIZONTAL_PADDING}>
      <Text inverse={props.selected}>
        <Text {...idColorProps}>{idText}</Text> <Text {...revColorProps}>{revText}</Text>{' '}
        {statusText} {iconText} {titleText}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Color Prop Builders
// ---------------------------------------------------------------------------

interface TextColorProps {
  color?: string;
  dimColor?: boolean;
}

function buildPriorityColorProps(priority: Priority | null): TextColorProps {
  const colorValue = getIssuePriorityColor(priority);
  if (colorValue === undefined) {
    return {};
  }
  if (colorValue === 'dim') {
    return { dimColor: true };
  }
  return { color: colorValue };
}

function buildRevisionColorProps(linkedRevision: Revision | null): TextColorProps {
  const colorValue = getRevisionColor(linkedRevision);
  if (colorValue === 'dim') {
    return { dimColor: true };
  }
  return { color: colorValue };
}

// ---------------------------------------------------------------------------
// Column Renderers
// ---------------------------------------------------------------------------

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

function renderRevisionColumn(linkedRevision: Revision | null): string {
  if (linkedRevision === null) {
    return padRight('\u2014', PR_COL_WIDTH);
  }
  return padRight(`PR#${linkedRevision.id}`, PR_COL_WIDTH);
}

function getRevisionColor(linkedRevision: Revision | null): string {
  if (linkedRevision === null) {
    return 'dim';
  }
  return getPipelineStatusColor(linkedRevision.pipeline?.status ?? null);
}

export function getPipelineStatusColor(status: PipelineStatus | null): string {
  if (status === null) {
    return 'dim';
  }
  return match(status)
    .with('failure', () => 'red')
    .with('pending', () => 'dim')
    .with('success', () => 'green')
    .exhaustive();
}

function renderStatusColumn(item: DisplayWorkItem): string {
  const display = STATUS_DISPLAY[item.displayStatus] ?? '';
  if (item.displayStatus === 'implementing') {
    return padRight(`WIP(${item.dispatchCount})`, STATUS_COL_WIDTH);
  }
  return padRight(display, STATUS_COL_WIDTH);
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
