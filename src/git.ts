import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    throw new Error(`git ${args.join(' ')} failed: ${String(e.stderr ?? e.message).trim()}`);
  }
}

function branchExists(repoRoot: string, branch: string): boolean {
  try {
    git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export function ensureBranches(repoRoot: string, base: string, integration: string, feat: string): void {
  if (!branchExists(repoRoot, integration)) git(repoRoot, ['branch', integration, base]);
  if (!branchExists(repoRoot, feat)) git(repoRoot, ['branch', feat, integration]);
}

export function ensureExcluded(repoRoot: string, pattern: string): void {
  let file = git(repoRoot, ['rev-parse', '--git-path', 'info/exclude']).trim();
  if (!isAbsolute(file)) file = join(repoRoot, file);
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').includes(pattern)) return;
  appendFileSync(file, (current === '' || current.endsWith('\n') ? '' : '\n') + pattern + '\n');
}

const featOf = (slug: string) => `feat/${slug}`;
const taskBranch = (slug: string, id: number) => `wt/${slug}/task-${id}`;
const wtRoot = (repoRoot: string, slug: string) => join(repoRoot, '.konoha', 'worktrees', slug);

export function integrationWorktree(repoRoot: string, slug: string): string {
  const path = join(wtRoot(repoRoot, slug), '_integration');
  if (!existsSync(path)) {
    mkdirSync(wtRoot(repoRoot, slug), { recursive: true });
    git(repoRoot, ['worktree', 'add', path, featOf(slug)]);
  }
  return path;
}

export function removeTaskWorktree(repoRoot: string, slug: string, taskId: number): void {
  const path = join(wtRoot(repoRoot, slug), `task-${taskId}`);
  if (existsSync(path)) {
    try {
      git(repoRoot, ['worktree', 'remove', '--force', path]);
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }
  git(repoRoot, ['worktree', 'prune']);
  if (branchExists(repoRoot, taskBranch(slug, taskId))) {
    git(repoRoot, ['branch', '-D', taskBranch(slug, taskId)]);
  }
}

export function createTaskWorktree(repoRoot: string, slug: string, taskId: number): string {
  removeTaskWorktree(repoRoot, slug, taskId);
  const path = join(wtRoot(repoRoot, slug), `task-${taskId}`);
  mkdirSync(wtRoot(repoRoot, slug), { recursive: true });
  git(repoRoot, ['worktree', 'add', '-b', taskBranch(slug, taskId), path, featOf(slug)]);
  return path;
}

export function commitAll(worktree: string, message: string, exclude: string[]): boolean {
  git(worktree, ['add', '-A', '--', '.', ...exclude.map((e) => `:(exclude)${e}`)]);
  try {
    git(worktree, ['diff', '--cached', '--quiet']);
    return false;
  } catch {
    git(worktree, ['commit', '-m', message]);
    return true;
  }
}

export function mergeTaskBranch(integrationWt: string, taskBranchName: string): 'merged' | 'conflict' {
  try {
    git(integrationWt, ['merge', '--no-ff', '-m', `merge ${taskBranchName}`, taskBranchName]);
    return 'merged';
  } catch {
    try {
      git(integrationWt, ['merge', '--abort']);
    } catch {
      git(integrationWt, ['reset', '--hard', 'HEAD']);
    }
    return 'conflict';
  }
}

export function undoLastMerge(integrationWt: string): void {
  git(integrationWt, ['reset', '--hard', 'HEAD~1']);
}

export function dirtySnapshot(paths: string[]): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const p of paths) snap[p] = git(p, ['status', '--porcelain']);
  return snap;
}

function checkedOutPath(repoRoot: string, branch: string): string | null {
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  let current: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

export function mergeFeatIntoDev(repoRoot: string, feat: string, integration: string): 'merged' | 'conflict' {
  let wt = checkedOutPath(repoRoot, integration);
  let temporary = false;
  if (wt && git(wt, ['status', '--porcelain', '--untracked-files=no']).trim() !== '') {
    throw new Error(`Nhánh ${integration} đang checkout ở ${wt} và có thay đổi chưa commit`);
  }
  if (!wt) {
    wt = join(repoRoot, '.konoha', 'worktrees', '_dev');
    mkdirSync(dirname(wt), { recursive: true });
    git(repoRoot, ['worktree', 'add', wt, integration]);
    temporary = true;
  }
  try {
    return mergeTaskBranch(wt, feat);
  } finally {
    if (temporary) git(repoRoot, ['worktree', 'remove', '--force', wt]);
  }
}
