import { expect, test } from 'vitest';
import { parseLabels } from './parse-labels.ts';

test('it defaults status to pending when no status label exists', () => {
  const result = parseLabels(['task:implement', 'priority:high']);
  expect(result.status).toBe('pending');
});

test('it picks the first status alphabetically when multiple status labels exist', () => {
  const result = parseLabels(['status:review', 'status:blocked', 'status:in-progress']);
  expect(result.status).toBe('blocked');
});

test('it parses priority from a priority label', () => {
  const result = parseLabels(['priority:medium']);
  expect(result.priority).toBe('medium');
});

test('it returns null priority when no priority label exists', () => {
  const result = parseLabels(['status:pending', 'task:implement']);
  expect(result.priority).toBeNull();
});

test('it parses complexity from a complexity label', () => {
  const result = parseLabels(['complexity:high']);
  expect(result.complexity).toBe('high');
});

test('it returns null complexity when no complexity label exists', () => {
  const result = parseLabels(['status:pending']);
  expect(result.complexity).toBeNull();
});

test('it handles labels as objects with name property', () => {
  const result = parseLabels([{ name: 'status:approved' }, { name: 'priority:low' }]);
  expect(result.status).toBe('approved');
  expect(result.priority).toBe('low');
});

test('it handles a mix of string labels and object labels', () => {
  const result = parseLabels(['complexity:trivial', { name: 'status:ready' }]);
  expect(result.status).toBe('ready');
  expect(result.complexity).toBe('trivial');
});

test('it discards object labels without a name property', () => {
  const result = parseLabels([{}, { name: 'status:closed' }]);
  expect(result.status).toBe('closed');
});

test('it discards unrecognized values within a recognized prefix before tie-breaking', () => {
  const result = parseLabels(['status:unknown', 'status:review']);
  expect(result.status).toBe('review');
});

test('it defaults status to pending when all status labels have unrecognized values', () => {
  const result = parseLabels(['status:unknown', 'status:invalid']);
  expect(result.status).toBe('pending');
});

test.each([
  'pending',
  'ready',
  'in-progress',
  'review',
  'approved',
  'closed',
  'needs-refinement',
  'blocked',
] as const)('it parses status value "%s" correctly', (status) => {
  const result = parseLabels([`status:${status}`]);
  expect(result.status).toBe(status);
});

test('it returns all three fields from a fully-labeled issue', () => {
  const result = parseLabels(['status:in-progress', 'priority:high', 'complexity:medium']);
  expect(result).toStrictEqual({
    status: 'in-progress',
    priority: 'high',
    complexity: 'medium',
  });
});

test('it handles an empty labels array', () => {
  const result = parseLabels([]);
  expect(result).toStrictEqual({
    status: 'pending',
    priority: null,
    complexity: null,
  });
});
