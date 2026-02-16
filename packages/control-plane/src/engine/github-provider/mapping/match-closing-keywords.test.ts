import { expect, test } from 'vitest';
import { matchClosingKeywords } from './match-closing-keywords.ts';

test('it matches "Closes #10" and returns the issue number', () => {
  expect(matchClosingKeywords('Closes #10')).toBe('10');
});

test('it matches "fixes #10" in lowercase', () => {
  expect(matchClosingKeywords('fixes #10')).toBe('10');
});

test('it returns null when no closing keyword is found', () => {
  expect(matchClosingKeywords('This PR does something')).toBeNull();
});

test('it matches a multi-digit issue number without partial capture', () => {
  expect(matchClosingKeywords('Closes #1001')).toBe('1001');
});

test('it returns the first match by position when multiple closing keywords exist', () => {
  expect(matchClosingKeywords('Closes #10 and Fixes #20')).toBe('10');
});

test('it handles all supported keywords case-insensitively', () => {
  const keywords = [
    'Close',
    'close',
    'CLOSE',
    'Closed',
    'closed',
    'Closes',
    'closes',
    'Fix',
    'fix',
    'Fixed',
    'fixed',
    'Fixes',
    'fixes',
    'Resolve',
    'resolve',
    'Resolved',
    'resolved',
    'Resolves',
    'resolves',
  ];

  for (const keyword of keywords) {
    expect(matchClosingKeywords(`${keyword} #99`)).toBe('99');
  }
});

test('it matches a closing keyword followed by end of string', () => {
  expect(matchClosingKeywords('Resolves #42')).toBe('42');
});

test('it matches a closing keyword followed by punctuation', () => {
  expect(matchClosingKeywords('Closes #5.')).toBe('5');
});

test('it matches a closing keyword followed by a newline', () => {
  expect(matchClosingKeywords('Closes #5\nMore text')).toBe('5');
});

test('it does not match when the keyword is not followed by a hash', () => {
  expect(matchClosingKeywords('Closes 10')).toBeNull();
});

test('it matches correctly when keyword appears mid-body', () => {
  expect(matchClosingKeywords('This PR\n\nCloses #15\n\nDone')).toBe('15');
});
