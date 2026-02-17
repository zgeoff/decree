import { expect, test } from 'vitest';
import { buildRevision } from '../../test-utils/build-revision.ts';
import { buildChangedRevisionEvent } from './build-changed-revision-event.ts';

test('it builds a changed revision event with old and new pipeline status', () => {
  const storedRevision = buildRevision({
    id: 'rev-1',
    workItemID: 'wi-1',
    pipeline: { status: 'pending', url: null, reason: null },
  });
  const providerRevision = buildRevision({
    id: 'rev-1',
    workItemID: 'wi-2',
    pipeline: { status: 'success', url: 'https://ci.example.com/1', reason: null },
  });
  const event = buildChangedRevisionEvent(providerRevision, storedRevision);

  expect(event).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-2',
    revision: providerRevision,
    oldPipelineStatus: 'pending',
    newPipelineStatus: 'success',
  });
});

test('it uses the provider revision work item association in the event', () => {
  const storedRevision = buildRevision({ id: 'rev-1', workItemID: 'wi-old' });
  const providerRevision = buildRevision({ id: 'rev-1', workItemID: 'wi-new' });
  const event = buildChangedRevisionEvent(providerRevision, storedRevision);

  expect(event.workItemID).toBe('wi-new');
});
