import { expect, test } from 'vitest';
import { buildSpec } from '../../test-utils/build-spec.ts';
import { buildModifiedSpecEvent } from './build-modified-spec-event.ts';

test('it builds a modified spec event with the correct type and change type', () => {
  const spec = buildSpec({
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-2',
    frontmatterStatus: 'draft',
  });
  const event = buildModifiedSpecEvent(spec, 'commit-abc');

  expect(event).toStrictEqual({
    type: 'specChanged',
    filePath: 'docs/specs/engine.md',
    blobSHA: 'sha-2',
    frontmatterStatus: 'draft',
    changeType: 'modified',
    commitSHA: 'commit-abc',
  });
});

test('it uses the provided commit SHA in the event', () => {
  const spec = buildSpec();
  const event = buildModifiedSpecEvent(spec, 'commit-xyz');

  expect(event.commitSHA).toBe('commit-xyz');
});
