import { expect, test } from 'vitest';
import { buildSpecChangedEvent } from './build-spec-changed-event.ts';

test('it returns a spec changed event with default values', () => {
  const event = buildSpecChangedEvent();

  expect(event).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/test.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
    changeType: 'added',
    commitSHA: 'commit-1',
  });
});

test('it applies overrides to the spec changed event', () => {
  const event = buildSpecChangedEvent({ filePath: 'docs/specs/other.md', blobSHA: 'sha-99' });

  expect(event).toMatchObject({ filePath: 'docs/specs/other.md', blobSHA: 'sha-99' });
});
