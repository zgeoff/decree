import { expect, test } from 'vitest';
import { buildSpec } from '../../test-utils/build-spec.ts';
import { buildAddedSpecEvent } from './build-added-spec-event.ts';

test('it builds an added spec event with the correct type and change type', () => {
  const spec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
  });
  const event = buildAddedSpecEvent(spec, 'commit-abc');

  expect(event).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-1',
    frontmatterStatus: 'approved',
    changeType: 'added',
    commitSHA: 'commit-abc',
  });
});

test('it uses the provided commit SHA in the event', () => {
  const spec = buildSpec();
  const event = buildAddedSpecEvent(spec, 'commit-xyz');

  expect(event.commitSHA).toBe('commit-xyz');
});
