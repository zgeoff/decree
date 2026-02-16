import { expect, test } from 'vitest';
import { parseDependencyMetadata } from './parse-dependency-metadata.ts';

test('it parses blocked-by issue numbers from a metadata comment', () => {
  const body = 'Some issue body\n\n<!-- decree:blockedBy #42 #43 -->';
  expect(parseDependencyMetadata(body)).toStrictEqual(['42', '43']);
});

test('it returns an empty array when no metadata comment exists', () => {
  const body = 'Just a normal issue body with no metadata.';
  expect(parseDependencyMetadata(body)).toStrictEqual([]);
});

test('it parses a single blocked-by reference', () => {
  const body = 'Body\n\n<!-- decree:blockedBy #7 -->';
  expect(parseDependencyMetadata(body)).toStrictEqual(['7']);
});

test('it returns an empty array for a metadata comment with no issue references', () => {
  const body = 'Body\n\n<!-- decree:blockedBy -->';
  expect(parseDependencyMetadata(body)).toStrictEqual([]);
});
