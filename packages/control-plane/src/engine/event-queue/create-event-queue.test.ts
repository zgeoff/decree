import { expect, test } from 'vitest';
import { createMockLogger } from '../../test-utils/create-mock-logger.ts';
import type { Logger } from '../create-logger.ts';
import type { EngineEvent } from '../state-store/domain-type-stubs.ts';
import { createEventQueue } from './create-event-queue.ts';
import type { EventQueue } from './types.ts';

interface SetupTestResult {
  queue: EventQueue;
  logger: Logger;
}

function setupTest(): SetupTestResult {
  const { logger } = createMockLogger();
  const queue = createEventQueue({ logger });
  return { queue, logger };
}

function buildWorkItemChangedEvent(workItemID: string): EngineEvent {
  return {
    type: 'workItemChanged',
    workItemID,
    workItem: {
      id: workItemID,
      title: 'Test task',
      status: 'pending',
      priority: 'high',
      complexity: 'low',
      blockedBy: [],
      createdAt: '2026-02-18T00:00:00Z',
      linkedRevision: null,
    },
    title: 'Test task',
    oldStatus: null,
    newStatus: 'pending',
    priority: 'high',
  };
}

function buildImplementorStartedEvent(sessionID: string): EngineEvent {
  return {
    type: 'implementorStarted',
    sessionID,
    logFilePath: null,
  };
}

function buildImplementorCompletedEvent(sessionID: string): EngineEvent {
  return {
    type: 'implementorCompleted',
    workItemID: '123',
    sessionID,
    branchName: 'feat/test',
    result: {
      role: 'implementor',
      outcome: 'completed',
      patch: null,
      summary: 'Implemented task',
    },
    logFilePath: null,
  };
}

test('it returns an EventQueue interface with required methods', () => {
  const { queue } = setupTest();

  expect(queue.enqueue).toBeDefined();
  expect(queue.dequeue).toBeDefined();
  expect(queue.isEmpty).toBeDefined();
  expect(queue.size).toBeDefined();
  expect(queue.setRejecting).toBeDefined();
});

test('it starts with an empty queue', () => {
  const { queue } = setupTest();

  expect(queue.isEmpty()).toBe(true);
  expect(queue.size()).toBe(0);
});

test('it appends an event to the queue when enqueue is called', () => {
  const { queue } = setupTest();
  const event = buildWorkItemChangedEvent('1');

  queue.enqueue(event);

  expect(queue.isEmpty()).toBe(false);
  expect(queue.size()).toBe(1);
});

test('it removes and returns the event at the head when dequeue is called', () => {
  const { queue } = setupTest();
  const event1 = buildWorkItemChangedEvent('1');
  const event2 = buildWorkItemChangedEvent('2');

  queue.enqueue(event1);
  queue.enqueue(event2);

  const dequeued = queue.dequeue();

  expect(dequeued).toStrictEqual(event1);
  expect(queue.size()).toBe(1);
});

test('it returns undefined when dequeue is called on an empty queue', () => {
  const { queue } = setupTest();

  const result = queue.dequeue();

  expect(result).toBeUndefined();
});

test('it returns true when isEmpty is called on an empty queue', () => {
  const { queue } = setupTest();

  expect(queue.isEmpty()).toBe(true);
});

test('it returns false when isEmpty is called on a non-empty queue', () => {
  const { queue } = setupTest();
  const event = buildWorkItemChangedEvent('1');

  queue.enqueue(event);

  expect(queue.isEmpty()).toBe(false);
});

test('it returns the current number of events when size is called', () => {
  const { queue } = setupTest();
  const event1 = buildWorkItemChangedEvent('1');
  const event2 = buildWorkItemChangedEvent('2');
  const event3 = buildWorkItemChangedEvent('3');

  expect(queue.size()).toBe(0);

  queue.enqueue(event1);
  expect(queue.size()).toBe(1);

  queue.enqueue(event2);
  expect(queue.size()).toBe(2);

  queue.enqueue(event3);
  expect(queue.size()).toBe(3);

  queue.dequeue();
  expect(queue.size()).toBe(2);
});

test('it maintains FIFO order when multiple events are enqueued and dequeued', () => {
  const { queue } = setupTest();
  const event1 = buildWorkItemChangedEvent('1');
  const event2 = buildWorkItemChangedEvent('2');
  const event3 = buildWorkItemChangedEvent('3');

  queue.enqueue(event1);
  queue.enqueue(event2);
  queue.enqueue(event3);

  expect(queue.dequeue()).toStrictEqual(event1);
  expect(queue.dequeue()).toStrictEqual(event2);
  expect(queue.dequeue()).toStrictEqual(event3);
  expect(queue.dequeue()).toBeUndefined();
});

test('it silently drops and logs when enqueue is called after setRejecting is enabled without filter', () => {
  const { queue, logger } = setupTest();
  const event = buildWorkItemChangedEvent('1');

  queue.setRejecting(true);

  queue.enqueue(event);

  expect(queue.size()).toBe(0);
  expect(logger.error).toHaveBeenCalledWith('event rejected during shutdown', {
    eventType: 'workItemChanged',
  });
});

test('it allows enqueue when setRejecting is disabled after being enabled', () => {
  const { queue } = setupTest();
  const event = buildWorkItemChangedEvent('1');

  queue.setRejecting(true);
  queue.setRejecting(false);

  queue.enqueue(event);

  expect(queue.size()).toBe(1);
});

test('it allows terminal events when setRejecting is enabled with a filter', () => {
  const { queue, logger } = setupTest();
  const startedEvent = buildImplementorStartedEvent('session-1');
  const completedEvent = buildImplementorCompletedEvent('session-1');
  const workItemEvent = buildWorkItemChangedEvent('1');

  const filter = (eventType: EngineEvent['type']): boolean =>
    eventType === 'implementorCompleted' ||
    eventType === 'implementorFailed' ||
    eventType === 'plannerCompleted' ||
    eventType === 'plannerFailed' ||
    eventType === 'reviewerCompleted' ||
    eventType === 'reviewerFailed';

  queue.setRejecting(true, filter);

  queue.enqueue(completedEvent);
  expect(queue.size()).toBe(1);

  queue.enqueue(startedEvent);
  expect(queue.size()).toBe(1);
  expect(logger.error).toHaveBeenCalledWith('event rejected during shutdown', {
    eventType: 'implementorStarted',
  });

  queue.enqueue(workItemEvent);
  expect(queue.size()).toBe(1);
  expect(logger.error).toHaveBeenCalledWith('event rejected during shutdown', {
    eventType: 'workItemChanged',
  });
});

test('it allows dequeue to work normally when rejecting mode is enabled', () => {
  const { queue } = setupTest();
  const event1 = buildWorkItemChangedEvent('1');
  const event2 = buildWorkItemChangedEvent('2');

  queue.enqueue(event1);
  queue.enqueue(event2);

  queue.setRejecting(true);

  expect(queue.dequeue()).toStrictEqual(event1);
  expect(queue.dequeue()).toStrictEqual(event2);
  expect(queue.isEmpty()).toBe(true);
});

test('it continues to track size correctly when rejecting mode is enabled', () => {
  const { queue } = setupTest();
  const event = buildWorkItemChangedEvent('1');

  queue.enqueue(event);
  queue.setRejecting(true);

  expect(queue.size()).toBe(1);

  queue.dequeue();

  expect(queue.size()).toBe(0);
  expect(queue.isEmpty()).toBe(true);
});
