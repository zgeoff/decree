import invariant from 'tiny-invariant';
import type { StoreApi } from 'zustand';
import { createCommandExecutor } from './command-executor/create-command-executor.ts';
import type { CommandExecutor } from './command-executor/types.ts';
import type { Logger } from './create-logger.ts';
import { createLogger } from './create-logger.ts';
import { defaultPolicy } from './default-policy.ts';
import { createEventQueue } from './event-queue/create-event-queue.ts';
import type { EventQueue } from './event-queue/types.ts';
import { createHandlers } from './handlers/create-handlers.ts';
import type { Handler } from './handlers/types.ts';
import { createRevisionPoller } from './pollers/create-revision-poller.ts';
import { createSpecPoller } from './pollers/create-spec-poller.ts';
import { createWorkItemPoller } from './pollers/create-work-item-poller.ts';
import { buildReviewHistoryFetcher } from './review-history-fetcher/build-review-history-fetcher.ts';
import type { AgentRunHandle } from './runtime-adapter/types.ts';
import { applyStateUpdate } from './state-store/apply-state-update.ts';
import { createEngineStore } from './state-store/create-engine-store.ts';
import type {
  EngineCommand,
  EngineEvent,
  RevisionChanged,
  SpecChanged,
  WorkItemChanged,
} from './state-store/domain-type-stubs.ts';
import type { EngineState } from './state-store/types.ts';
import type { Engine, EngineConfig } from './types.ts';

const DEFAULT_SHUTDOWN_TIMEOUT = 300;
const DEFAULT_WORK_ITEM_POLL_INTERVAL = 30;
const DEFAULT_REVISION_POLL_INTERVAL = 30;
const DEFAULT_SPEC_POLL_INTERVAL = 60;
const LOOP_IDLE_DELAY_MS = 50;
const MS_PER_SECOND = 1000;

const TERMINAL_EVENT_TYPES: Record<string, true> = {
  plannerCompleted: true,
  plannerFailed: true,
  implementorCompleted: true,
  implementorFailed: true,
  reviewerCompleted: true,
  reviewerFailed: true,
};

interface ProcessEventDeps {
  store: StoreApi<EngineState>;
  queue: EventQueue;
  executor: CommandExecutor;
  handlers: Handler[];
  logger: Logger;
}

export function createEngine(config: EngineConfig): Engine {
  validateConfig(config);

  // 1. Create logger
  const logger = createLogger({ logLevel: config.logLevel ?? 'info' });

  // 2. Create state store
  const store = createEngineStore();

  // 3. Create event queue
  const queue = createEventQueue({ logger });

  // 4. Create runtime adapters
  const getReviewHistory = buildReviewHistoryFetcher(config.provider.revisionReader);
  const runtimeAdapters = config.createRuntimeAdapters({
    workItemReader: config.provider.workItemReader,
    revisionReader: config.provider.revisionReader,
    getState: store.getState,
    getReviewHistory,
  });

  // 5. Agent handle map — populated via callbacks from the CommandExecutor
  const agentHandles = new Map<string, AgentRunHandle>();

  // 6. Create command executor
  const policy = config.policy ?? defaultPolicy;
  const executor = createCommandExecutor({
    workItemWriter: config.provider.workItemWriter,
    revisionWriter: config.provider.revisionWriter,
    runtimeAdapters,
    policy,
    getState: store.getState,
    enqueue: (event: EngineEvent) => {
      queue.enqueue(event);
    },
    onHandleRegistered: (sessionID: string, handle: AgentRunHandle) => {
      agentHandles.set(sessionID, handle);
    },
    onHandleRemoved: (sessionID: string) => {
      agentHandles.delete(sessionID);
    },
  });

  // 7. Create handlers
  const handlers = createHandlers();

  // 8. Create pollers
  const workItemPoller = createWorkItemPoller({
    reader: config.provider.workItemReader,
    getState: store.getState,
    enqueue: (event: WorkItemChanged) => {
      queue.enqueue(event);
    },
    interval: config.workItemPoller?.pollInterval ?? DEFAULT_WORK_ITEM_POLL_INTERVAL,
  });

  const revisionPoller = createRevisionPoller({
    reader: config.provider.revisionReader,
    getState: store.getState,
    enqueue: (event: RevisionChanged) => {
      queue.enqueue(event);
    },
    interval: config.revisionPoller?.pollInterval ?? DEFAULT_REVISION_POLL_INTERVAL,
  });

  const specPoller = createSpecPoller({
    reader: config.provider.specReader,
    getState: store.getState,
    enqueue: (event: SpecChanged) => {
      queue.enqueue(event);
    },
    interval: config.specPoller?.pollInterval ?? DEFAULT_SPEC_POLL_INTERVAL,
  });

  // Engine internal state
  const shutdownTimeout = config.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
  let running = false;
  let loopPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  const deps: ProcessEventDeps = { store, queue, executor, handlers, logger };

  // 9. Return Engine
  return {
    store,
    start: startEngine,
    stop: stopEngine,
    enqueue: enqueueEvent,
    getState: store.getState,
    subscribe: (listener: (engineState: EngineState) => void) => store.subscribe(listener),
    getWorkItemBody: (id: string) => config.provider.workItemReader.getWorkItemBody(id),
    getRevisionFiles: (id: string) => config.provider.revisionReader.getRevisionFiles(id),
    getAgentStream: (sessionID: string) => lookupAgentStream(agentHandles, sessionID),
    refresh: triggerRefresh,
  };

  // --- Public interface implementations ---

  function enqueueEvent(event: EngineEvent): void {
    queue.enqueue(event);
  }

  function triggerRefresh(): void {
    workItemPoller.poll().catch(() => {
      // Errors handled internally by pollers
    });
    revisionPoller.poll().catch(() => {
      // Errors handled internally by pollers
    });
    specPoller.poll().catch(() => {
      // Errors handled internally by pollers
    });
  }

  // --- Engine lifecycle ---

  async function startEngine(): Promise<void> {
    // First poll cycle — awaited so store is populated before start() resolves
    await Promise.all([workItemPoller.poll(), revisionPoller.poll(), specPoller.poll()]);

    // Start the processing loop
    running = true;
    loopPromise = runProcessingLoop();
  }

  function stopEngine(): Promise<void> {
    if (stopPromise !== null) {
      return stopPromise;
    }
    stopPromise = performStop();
    return stopPromise;
  }

  async function performStop(): Promise<void> {
    // 1. Mark the engine as shutting down — reject new events (except terminal agent events)
    queue.setRejecting(true, isTerminalEventType);

    // 2. Cancel all active agent runs
    const currentState = store.getState();
    const activeSessionIDs: string[] = [];
    for (const [sessionID, run] of currentState.agentRuns) {
      if (run.status === 'requested' || run.status === 'running') {
        activeSessionIDs.push(sessionID);
        runtimeAdapters[run.role].cancelAgent(sessionID);
      }
    }

    // 3. Wait for monitors to drain terminal events, up to shutdownTimeout
    if (activeSessionIDs.length > 0) {
      await waitForMonitorsDrain(store, activeSessionIDs, shutdownTimeout);
    }

    // 4. Stop all pollers
    workItemPoller.stop();
    revisionPoller.stop();
    specPoller.stop();

    // 5. Drain the event queue — process remaining events
    await drainEventQueue();

    // 6. Stop the processing loop
    running = false;
    if (loopPromise !== null) {
      await loopPromise;
      loopPromise = null;
    }

    // Clean up agent handles
    agentHandles.clear();
  }

  // --- Processing loop ---

  async function runProcessingLoop(): Promise<void> {
    while (running) {
      const event = queue.dequeue();
      if (event) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential event processing is required by spec
        await processEvent(deps, event);
      } else {
        await delay(LOOP_IDLE_DELAY_MS);
      }
    }
  }

  async function drainEventQueue(): Promise<void> {
    while (!queue.isEmpty()) {
      const event = queue.dequeue();
      if (event) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential drain processing is required by spec
        await processEvent(deps, event);
      }
    }
  }
}

// --- Event processing (stateless — receives all dependencies as parameters) ---

async function processEvent(processDeps: ProcessEventDeps, event: EngineEvent): Promise<void> {
  // 1. Apply state update
  applyStateUpdate(processDeps.store, event, processDeps.logger);

  // 2. Capture snapshot once — all handlers and commands see the same state
  const snapshot = processDeps.store.getState();

  // 3. Run all handlers with the same snapshot
  const commands = collectHandlerCommands(processDeps.handlers, event, snapshot);

  // 4. Execute each command with the same snapshot; enqueue result events
  for (const command of commands) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential command execution is required by spec
    const resultEvents = await processDeps.executor.execute(command, snapshot);
    for (const resultEvent of resultEvents) {
      processDeps.queue.enqueue(resultEvent);
    }
  }
}

function collectHandlerCommands(
  eventHandlers: Handler[],
  event: EngineEvent,
  engineState: EngineState,
): EngineCommand[] {
  const commands: EngineCommand[] = [];
  for (const handler of eventHandlers) {
    commands.push(...handler(event, engineState));
  }
  return commands;
}

// --- Agent stream lookup ---

function lookupAgentStream(
  handles: Map<string, AgentRunHandle>,
  sessionID: string,
): AsyncIterable<string> | null {
  const handle = handles.get(sessionID);
  if (!handle) {
    return null;
  }
  return handle.output;
}

// --- Shutdown helpers ---

function isTerminalEventType(eventType: EngineEvent['type']): boolean {
  return eventType in TERMINAL_EVENT_TYPES;
}

async function waitForMonitorsDrain(
  store: StoreApi<EngineState>,
  activeSessionIDs: string[],
  timeoutSeconds: number,
): Promise<void> {
  const timeoutMs = timeoutSeconds * MS_PER_SECOND;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const currentState = store.getState();
    const stillActive = activeSessionIDs.some((sessionID) => {
      const run = currentState.agentRuns.get(sessionID);
      return run !== undefined && (run.status === 'requested' || run.status === 'running');
    });

    if (!stillActive) {
      return;
    }

    // biome-ignore lint/performance/noAwaitInLoops: sequential polling is intentional for drain wait
    await delay(LOOP_IDLE_DELAY_MS);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// --- Config validation ---

function validateConfig(config: EngineConfig): void {
  invariant(config.provider, 'EngineConfig.provider is required');
  invariant(config.provider.workItemReader, 'EngineConfig.provider.workItemReader is required');
  invariant(config.provider.workItemWriter, 'EngineConfig.provider.workItemWriter is required');
  invariant(config.provider.revisionReader, 'EngineConfig.provider.revisionReader is required');
  invariant(config.provider.revisionWriter, 'EngineConfig.provider.revisionWriter is required');
  invariant(config.provider.specReader, 'EngineConfig.provider.specReader is required');
  invariant(config.createRuntimeAdapters, 'EngineConfig.createRuntimeAdapters is required');
}
