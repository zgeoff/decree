import { expect, test } from 'vitest';
import { buildBranchName } from './build-branch-name.ts';

test('it returns a branch name prefixed with decree and the work item identifier', () => {
  expect(buildBranchName('42')).toBe('decree/42');
});
