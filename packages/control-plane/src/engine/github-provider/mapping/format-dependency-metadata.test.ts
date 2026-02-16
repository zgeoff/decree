import { expect, test } from 'vitest';
import { formatDependencyMetadata } from './format-dependency-metadata.ts';

test('it appends a metadata comment after a blank line when formatting with dependencies', () => {
  const result = formatDependencyMetadata('Issue body', ['42', '43']);
  expect(result).toBe('Issue body\n\n<!-- decree:blockedBy #42 #43 -->');
});

test('it returns the body unchanged when formatting with an empty blocked-by list', () => {
  const result = formatDependencyMetadata('Issue body', []);
  expect(result).toBe('Issue body');
});

test('it formats a single dependency correctly', () => {
  const result = formatDependencyMetadata('Body text', ['10']);
  expect(result).toBe('Body text\n\n<!-- decree:blockedBy #10 -->');
});
