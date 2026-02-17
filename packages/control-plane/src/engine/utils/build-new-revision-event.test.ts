import { expect, test } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildNewRevisionEvent } from './build-new-revision-event.ts';

test('it builds a new revision event with null old pipeline status', () => {
  const revision = buildRevision({
    id: 'rev-1',
    workItemID: 'wi-1',
    pipeline: { status: 'pending', url: null, reason: null },
  });
  const event = buildNewRevisionEvent(revision);

  expect(event).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-1',
    revision,
    oldPipelineStatus: null,
    newPipelineStatus: 'pending',
  });
});

test('it sets both pipeline statuses to null when the revision has no pipeline', () => {
  const revision = buildRevision({ id: 'rev-2', pipeline: null });
  const event = buildNewRevisionEvent(revision);

  expect(event.oldPipelineStatus).toBeNull();
  expect(event.newPipelineStatus).toBeNull();
});
