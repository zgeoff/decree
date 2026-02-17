import { expect, test } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildRemovedRevisionEvent } from './build-removed-revision-event.ts';

test('it builds a removed revision event with null new pipeline status', () => {
  const revision = buildRevision({
    id: 'rev-1',
    workItemID: 'wi-1',
    pipeline: { status: 'success', url: null, reason: null },
  });
  const event = buildRemovedRevisionEvent(revision);

  expect(event).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-1',
    revision,
    oldPipelineStatus: 'success',
    newPipelineStatus: null,
  });
});

test('it preserves the stored revision work item association in the event', () => {
  const revision = buildRevision({ id: 'rev-2', workItemID: 'wi-3' });
  const event = buildRemovedRevisionEvent(revision);

  expect(event.workItemID).toBe('wi-3');
});
