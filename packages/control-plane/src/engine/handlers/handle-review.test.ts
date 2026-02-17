import { expect, test } from 'vitest';
import { buildReviewerCompletedEvent } from '../../test-utils/build-reviewer-completed-event.ts';
import { buildReviewerFailedEvent } from '../../test-utils/build-reviewer-failed-event.ts';
import { buildReviewerRequestedEvent } from '../../test-utils/build-reviewer-requested-event.ts';
import { buildReviewerStartedEvent } from '../../test-utils/build-reviewer-started-event.ts';
import { buildRevisionChangedEvent } from '../../test-utils/build-revision-changed-event.ts';
import { buildSpecChangedEvent } from '../../test-utils/build-spec-changed-event.ts';
import { buildWorkItem } from '../../test-utils/build-work-item.ts';
import { buildWorkItemChangedUpsert } from '../../test-utils/build-work-item-changed-upsert.ts';
import type { EngineState } from '../state-store/types.ts';
import { handleReview } from './handle-review.ts';

function setupTest(overrides?: Partial<EngineState>): EngineState {
  return {
    workItems: new Map(),
    revisions: new Map(),
    specs: new Map(),
    agentRuns: new Map(),
    errors: [],
    lastPlannedSHAs: new Map(),
    ...overrides,
  };
}

test('it requests a reviewer run when the pipeline succeeds and the work item is in review', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'review' });
  const state = setupTest({ workItems: new Map([['wi-1', workItem]]) });
  const event = buildRevisionChangedEvent({
    revisionID: 'rev-1',
    workItemID: 'wi-1',
    newPipelineStatus: 'success',
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([
    { command: 'requestReviewerRun', workItemID: 'wi-1', revisionID: 'rev-1' },
  ]);
});

test('it returns no commands when the pipeline status is not success', () => {
  const state = setupTest();
  const event = buildRevisionChangedEvent({ newPipelineStatus: 'failure' });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the pipeline status is null', () => {
  const state = setupTest();
  const event = buildRevisionChangedEvent({ newPipelineStatus: null });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the revision has no linked work item', () => {
  const state = setupTest();
  const event = buildRevisionChangedEvent({
    workItemID: null,
    newPipelineStatus: 'success',
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the linked work item is not found in state', () => {
  const state = setupTest();
  const event = buildRevisionChangedEvent({
    workItemID: 'wi-missing',
    newPipelineStatus: 'success',
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the linked work item has approved status', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'approved' });
  const state = setupTest({ workItems: new Map([['wi-1', workItem]]) });
  const event = buildRevisionChangedEvent({
    workItemID: 'wi-1',
    newPipelineStatus: 'success',
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands when the linked work item has needs-refinement status', () => {
  const workItem = buildWorkItem({ id: 'wi-1', status: 'needs-refinement' });
  const state = setupTest({ workItems: new Map([['wi-1', workItem]]) });
  const event = buildRevisionChangedEvent({
    workItemID: 'wi-1',
    newPipelineStatus: 'success',
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it emits the reviewer result when the reviewer completes', () => {
  const state = setupTest();
  const result = {
    role: 'reviewer' as const,
    review: { verdict: 'approve' as const, summary: 'Looks good', comments: [] },
  };
  const event = buildReviewerCompletedEvent({
    workItemID: 'wi-3',
    revisionID: 'rev-5',
    result,
  });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([
    { command: 'applyReviewerResult', workItemID: 'wi-3', revisionID: 'rev-5', result },
  ]);
});

test('it transitions the work item to pending when the reviewer fails', () => {
  const state = setupTest();
  const event = buildReviewerFailedEvent({ workItemID: 'wi-4' });

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([
    { command: 'transitionWorkItemStatus', workItemID: 'wi-4', newStatus: 'pending' },
  ]);
});

test('it returns no commands for a reviewer requested event', () => {
  const state = setupTest();
  const event = buildReviewerRequestedEvent();

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for a reviewer started event', () => {
  const state = setupTest();
  const event = buildReviewerStartedEvent();

  const commands = handleReview(event, state);

  expect(commands).toStrictEqual([]);
});

test('it returns no commands for unrelated event types', () => {
  const state = setupTest();

  expect(handleReview(buildSpecChangedEvent(), state)).toStrictEqual([]);
  expect(handleReview(buildWorkItemChangedUpsert(), state)).toStrictEqual([]);
});
