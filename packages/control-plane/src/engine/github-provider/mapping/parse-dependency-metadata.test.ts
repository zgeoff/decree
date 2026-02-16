import { expect, test } from 'vitest';
import {
  formatDependencyMetadata,
  parseDependencyMetadata,
  stripDependencyMetadata,
} from './parse-dependency-metadata.ts';

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
