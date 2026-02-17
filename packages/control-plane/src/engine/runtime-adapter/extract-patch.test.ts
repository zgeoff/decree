import type { ExecFileException } from 'node:child_process';
import { execFile } from 'node:child_process';
import type { Mock } from 'vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { extractPatch } from './extract-patch.ts';

vi.mock('node:child_process');
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

const mockExecFile: Mock = vi.mocked(execFile);

function setupExecFileMock(stdout: string, stderr?: string): void {
  mockExecFile.mockResolvedValue({ stdout, stderr: stderr ?? '' });
}

afterEach(() => {
  vi.clearAllMocks();
});

test('it extracts a non-empty unified diff from the worktree', async () => {
  const diffOutput = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  console.log('bar');
   return 42;
 }
`;

  setupExecFileMock(diffOutput);

  const patch = await extractPatch('/path/to/worktree', 'main');

  expect(mockExecFile).toHaveBeenCalledWith('git', ['diff', 'main..HEAD'], {
    cwd: '/path/to/worktree',
    encoding: 'utf8',
  });
  expect(patch).toBe(diffOutput);
});

test('it throws when the diff is empty', async () => {
  setupExecFileMock('');

  await expect(extractPatch('/path/to/worktree', 'main')).rejects.toThrow(
    'Agent reported completed but made no changes — empty diff vs main',
  );
});

test('it throws when the diff is only whitespace', async () => {
  setupExecFileMock('   \n\t  \n  ');

  await expect(extractPatch('/path/to/worktree', 'main')).rejects.toThrow(
    'Agent reported completed but made no changes — empty diff vs main',
  );
});

test('it uses the provided default branch name in the diff command', async () => {
  setupExecFileMock('diff --git a/file.txt b/file.txt\n...');

  await extractPatch('/path/to/worktree', 'develop');

  expect(mockExecFile).toHaveBeenCalledWith('git', ['diff', 'develop..HEAD'], {
    cwd: '/path/to/worktree',
    encoding: 'utf8',
  });
});

test('it executes git diff in the specified worktree directory', async () => {
  setupExecFileMock('diff --git a/file.txt b/file.txt\n...');

  await extractPatch('/custom/worktree/path', 'main');

  expect(mockExecFile).toHaveBeenCalledWith('git', expect.any(Array), {
    cwd: '/custom/worktree/path',
    encoding: 'utf8',
  });
});

test('it throws when git diff fails', async () => {
  const error: ExecFileException = new Error('fatal: not a git repository');
  mockExecFile.mockRejectedValue(error);

  await expect(extractPatch('/invalid/path', 'main')).rejects.toThrow(
    'fatal: not a git repository',
  );
});
