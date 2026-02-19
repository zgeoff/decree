import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RevisionFile } from '../engine/github-provider/types.ts';
import type {
  EngineState,
  ImplementorRun,
  ReviewerRun,
  UserRequestedImplementorRun,
} from '../engine/state-store/types.ts';
import type {
  CachedDetail,
  DisplayStatus,
  DisplayWorkItem,
  TUIActions,
  TUILocalState,
} from './types.ts';
import { deriveDisplayStatus } from './types.ts';

const STREAM_BUFFER_LIMIT = 10_000;

const BODY_FETCH_STATUSES: ReadonlySet<DisplayStatus> = new Set([
  'dispatch',
  'pending',
  'needs-refinement',
  'blocked',
]);

const REVISION_FILES_FETCH_STATUSES: ReadonlySet<DisplayStatus> = new Set(['approved']);

// ---------------------------------------------------------------------------
// Engine interface (v2 public surface consumed by the TUI store)
// ---------------------------------------------------------------------------

interface TUIEngineStore {
  getState: () => EngineState;
  subscribe: (listener: (state: EngineState, prev: EngineState) => void) => () => void;
}

export interface TUIEngine {
  store: TUIEngineStore;
  enqueue: (event: UserRequestedImplementorRun) => void;
  stop: () => Promise<void>;
  getWorkItemBody: (id: string) => Promise<string>;
  getRevisionFiles: (id: string) => Promise<RevisionFile[]>;
  getAgentStream: (sessionID: string) => AsyncIterable<string> | null;
}

export interface CreateTUIStoreConfig {
  engine: TUIEngine;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createTUIStore(config: CreateTUIStoreConfig): StoreApi<TUILocalState & TUIActions> {
  const { engine } = config;

  const store = createStore<TUILocalState & TUIActions>((set, get) => ({
    selectedWorkItem: null,
    pinnedWorkItem: null,
    focusedPane: 'workItemList',
    shuttingDown: false,
    streamBuffers: new Map(),
    detailCache: new Map(),

    dispatchImplementor(workItemID: string): void {
      engine.enqueue({ type: 'userRequestedImplementorRun', workItemID });
    },

    shutdown(): void {
      set({ shuttingDown: true });
      engine.stop().catch(() => {
        // Stop failure is non-fatal — the process is exiting
      });
    },

    selectWorkItem(workItemID: string): void {
      set({ selectedWorkItem: workItemID });
    },

    pinWorkItem(workItemID: string): void {
      const prevPinned = get().pinnedWorkItem;

      if (prevPinned !== workItemID) {
        // Clear stream buffers and detail cache on pin change
        set({
          pinnedWorkItem: workItemID,
          streamBuffers: new Map(),
          detailCache: new Map(),
        });
      } else {
        set({ pinnedWorkItem: workItemID });
      }

      // Trigger on-demand fetch if not cached — fire-and-forget
      fetchDetailIfNeeded(workItemID).catch(() => {
        // Fetch failure is non-fatal
      });
    },

    cycleFocus(): void {
      const current = get().focusedPane;
      set({ focusedPane: current === 'workItemList' ? 'detailPane' : 'workItemList' });
    },

    handleWorkItemRemoval(removedID: string, sortedItems: DisplayWorkItem[]): void {
      const state = get();
      const updates: Partial<TUILocalState> = {};

      if (state.selectedWorkItem === removedID) {
        updates.selectedWorkItem = findNextWorkItem(removedID, sortedItems);
      }

      if (state.pinnedWorkItem === removedID) {
        updates.pinnedWorkItem = null;
        const detailCache = new Map(state.detailCache);
        detailCache.delete(removedID);
        updates.detailCache = detailCache;
      }

      // Clear stream buffers for sessions associated with the removed work item
      const removedSessionIDs = findSessionIDsForWorkItem(removedID, engine);
      if (removedSessionIDs.length > 0) {
        const streamBuffers = new Map(state.streamBuffers);
        for (const sessionID of removedSessionIDs) {
          streamBuffers.delete(sessionID);
        }
        updates.streamBuffers = streamBuffers;
      }

      set(updates);
    },
  }));

  return store;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function fetchDetailIfNeeded(workItemID: string): Promise<void> {
    const state = store.getState();
    const cached = state.detailCache.get(workItemID);

    if (cached && !cached.loading) {
      return;
    }

    // Derive display status to determine what to fetch
    const displayStatus = deriveDisplayStatusForWorkItem(workItemID, engine);
    const shouldFetchBody = displayStatus !== null && BODY_FETCH_STATUSES.has(displayStatus);
    const shouldFetchRevisionFiles =
      displayStatus !== null && REVISION_FILES_FETCH_STATUSES.has(displayStatus);

    if (!(shouldFetchBody || shouldFetchRevisionFiles)) {
      return;
    }

    // Set loading state
    const detailCacheLoading = new Map(state.detailCache);
    const loadingEntry: CachedDetail = { body: null, revisionFiles: null, loading: true };
    detailCacheLoading.set(workItemID, loadingEntry);
    store.setState({ detailCache: detailCacheLoading });

    try {
      const [body, revisionFiles] = await Promise.all([
        shouldFetchBody ? fetchBody(workItemID) : Promise.resolve(null),
        shouldFetchRevisionFiles ? fetchRevisionFiles(workItemID) : Promise.resolve(null),
      ]);

      const current = store.getState();
      // Only update if still pinned to the same work item
      if (current.pinnedWorkItem !== workItemID) {
        return;
      }

      const detailCache = new Map(current.detailCache);
      detailCache.set(workItemID, { body, revisionFiles, loading: false });
      store.setState({ detailCache });
    } catch {
      // Fetch failure is non-fatal; remove loading state
      const current = store.getState();
      if (current.pinnedWorkItem !== workItemID) {
        return;
      }
      const detailCache = new Map(current.detailCache);
      detailCache.set(workItemID, { body: null, revisionFiles: null, loading: false });
      store.setState({ detailCache });
    }
  }

  async function fetchBody(workItemID: string): Promise<string | null> {
    try {
      return await engine.getWorkItemBody(workItemID);
    } catch {
      return null;
    }
  }

  async function fetchRevisionFiles(workItemID: string): Promise<RevisionFile[] | null> {
    try {
      return await engine.getRevisionFiles(workItemID);
    } catch {
      return null;
    }
  }

  function findNextWorkItem(removedID: string, sortedItems: DisplayWorkItem[]): string | null {
    const remaining = sortedItems.filter((item) => item.workItem.id !== removedID);
    if (remaining.length === 0) {
      return null;
    }

    const removedIndex = sortedItems.findIndex((item) => item.workItem.id === removedID);

    // Next item in sort order, or previous if at the end
    if (removedIndex < remaining.length) {
      const next = remaining[removedIndex];
      if (next) {
        return next.workItem.id;
      }
    }

    const last = remaining.at(-1);
    if (last) {
      return last.workItem.id;
    }

    return null;
  }

  function findSessionIDsForWorkItem(workItemID: string, eng: TUIEngine): string[] {
    const engineState = eng.store.getState();
    const sessionIDs: string[] = [];

    for (const run of engineState.agentRuns.values()) {
      if (run.role !== 'planner' && run.workItemID === workItemID) {
        sessionIDs.push(run.sessionID);
      }
    }

    return sessionIDs;
  }

  function deriveDisplayStatusForWorkItem(
    workItemID: string,
    eng: TUIEngine,
  ): DisplayStatus | null {
    const engineState = eng.store.getState();
    const workItem = engineState.workItems.get(workItemID);
    if (!workItem) {
      return null;
    }

    const runs: Array<ImplementorRun | ReviewerRun> = [];
    for (const run of engineState.agentRuns.values()) {
      if (run.role !== 'planner' && run.workItemID === workItemID) {
        runs.push(run);
      }
    }

    return deriveDisplayStatus(workItem, runs);
  }
}

// ---------------------------------------------------------------------------
// Stream buffer helpers (exported for use by consuming components)
// ---------------------------------------------------------------------------

export function appendStreamLines(
  store: StoreApi<TUILocalState & TUIActions>,
  sessionID: string,
  lines: string[],
): void {
  const state = store.getState();
  const streamBuffers = new Map(state.streamBuffers);
  const buffer = [...(streamBuffers.get(sessionID) ?? []), ...lines];

  const overflow = buffer.length - STREAM_BUFFER_LIMIT;

  if (overflow > 0) {
    buffer.splice(0, overflow);
  }

  streamBuffers.set(sessionID, buffer);
  store.setState({ streamBuffers });
}

export function clearStreamBuffer(
  store: StoreApi<TUILocalState & TUIActions>,
  sessionID: string,
): void {
  const state = store.getState();
  if (!state.streamBuffers.has(sessionID)) {
    return;
  }
  const streamBuffers = new Map(state.streamBuffers);
  streamBuffers.delete(sessionID);
  store.setState({ streamBuffers });
}

export function consumeAgentStream(
  tuiStore: StoreApi<TUILocalState & TUIActions>,
  engine: TUIEngine,
  sessionID: string,
): void {
  const stream = engine.getAgentStream(sessionID);
  if (!stream) {
    return;
  }

  consumeStream(tuiStore, stream, sessionID).catch(() => {
    // Stream consumption failure is non-fatal
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function consumeStream(
  tuiStore: StoreApi<TUILocalState & TUIActions>,
  stream: AsyncIterable<string>,
  sessionID: string,
): Promise<void> {
  for await (const chunk of stream) {
    const lines = splitChunkIntoLines(chunk);
    if (lines.length > 0) {
      appendStreamLines(tuiStore, sessionID, lines);
    }
  }
}

function splitChunkIntoLines(chunk: string): string[] {
  const parts = chunk.split('\n');
  if (parts.length > 0 && parts.at(-1) === '') {
    parts.pop();
  }
  return parts;
}
