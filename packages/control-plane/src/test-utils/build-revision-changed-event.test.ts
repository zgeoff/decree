import { expect, test } from 'vitest';
import { buildRevisionChangedEvent } from './build-revision-changed-event.ts';

test('it returns a revision changed event with default values', () => {
  const event = buildRevisionChangedEvent();

  expect(event).toStrictEqual({
    type: 'revisionChanged',
    revisionID: 'rev-1',
    workItemID: 'wi-1',
    revision: {
      id: 'rev-1',
      title: 'Test revision',
      url: 'https://example.com/pr/1',
      headSHA: 'abc123',
      headRef: 'feature/test',
      author: 'test-user',
      body: 'Test body',
      isDraft: false,
      workItemID: 'wi-1',
      pipeline: null,
      reviewID: null,
    },
    oldPipelineStatus: null,
    newPipelineStatus: null,
  });
});

test('it applies overrides to the revision changed event', () => {
  const event = buildRevisionChangedEvent({ revisionID: 'rev-99', newPipelineStatus: 'success' });

  expect(event).toMatchObject({ revisionID: 'rev-99', newPipelineStatus: 'success' });
});
