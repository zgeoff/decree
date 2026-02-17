import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync: (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile) as (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Extracts a unified diff patch from the worktree by running git diff.
 *
 * @param worktreeDir - Absolute path to the worktree directory
 * @param defaultBranch - Name of the default branch to diff against (e.g., 'main')
 * @returns The unified diff string
 * @throws When the diff is empty (agent reported completed but made no changes)
 * @throws When git diff fails
 */
export async function extractPatch(worktreeDir: string, defaultBranch: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', `${defaultBranch}..HEAD`], {
    cwd: worktreeDir,
    encoding: 'utf8',
  });

  if (stdout.trim().length === 0) {
    throw new Error(
      `Agent reported completed but made no changes — empty diff vs ${defaultBranch}`,
    );
  }

  return stdout;
}
