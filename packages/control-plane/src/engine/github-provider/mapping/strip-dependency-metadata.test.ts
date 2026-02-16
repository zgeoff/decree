import { expect, test } from 'vitest';
import { stripDependencyMetadata } from './strip-dependency-metadata.ts';

test('it strips the metadata comment from a body', () => {
  const body = 'Clean content\n\n<!-- decree:blockedBy #42 #43 -->';
  expect(stripDependencyMetadata(body)).toBe('Clean content');
});

test('it returns the body unchanged when stripping and no metadata comment exists', () => {
  const body = 'Just content, no metadata.';
  expect(stripDependencyMetadata(body)).toBe('Just content, no metadata.');
});

test('it strips the metadata comment even with a single blank line before it', () => {
  const body = 'Content here\n\n<!-- decree:blockedBy #1 -->';
  expect(stripDependencyMetadata(body)).toBe('Content here');
});
