import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  git, ensureBranches, ensureExcluded, integrationWorktree, createTaskWorktree,
  commitAll, mergeTaskBranch, undoLastMerge, dirtySnapshot, mergeFeatIntoDev,
} from '../src/git.js';
import { makeRepo } from './helpers/tmpRepo.js';

function setup() {
  const root = makeRepo();
  ensureBranches(root, 'main', 'dev', 'feat/x');
  return { root, integ: integrationWorktree(root, 'x') };
}

describe('git helpers', () => {
  it('ensureBranches creates dev from main and feat from dev', () => {
    const root = makeRepo();
    ensureBranches(root, 'main', 'dev', 'feat/x');
    const branches = git(root, ['branch', '--list']);
    expect(branches).toContain('dev');
    expect(branches).toContain('feat/x');
    expect(() => ensureBranches(root, 'main', 'dev', 'feat/x')).not.toThrow();
  });

  it('task worktree branches from feat and is reset when recreated', () => {
    const { root } = setup();
    const wt = createTaskWorktree(root, 'x', 1);
    expect(existsSync(wt)).toBe(true);
    expect(git(wt, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('wt/x/task-1');
    writeFileSync(join(wt, 'dirty.txt'), 'junk');
    const again = createTaskWorktree(root, 'x', 1);
    expect(again).toBe(wt);
    expect(existsSync(join(wt, 'dirty.txt'))).toBe(false);
    expect(git(wt, ['status', '--porcelain']).trim()).toBe('');
  });

  it('commitAll returns false when nothing changed, true on change, and skips excluded files', () => {
    const { root } = setup();
    const wt = createTaskWorktree(root, 'x', 1);
    expect(commitAll(wt, 'msg', ['.konoha-blocked.json'])).toBe(false);
    writeFileSync(join(wt, 'a.txt'), 'a');
    writeFileSync(join(wt, '.konoha-blocked.json'), '{}');
    expect(commitAll(wt, 'msg', ['.konoha-blocked.json'])).toBe(true);
    expect(git(wt, ['show', '--name-only', '--format=', 'HEAD']).trim()).toBe('a.txt');
  });

  it('merge conflict aborts and leaves feat unchanged', () => {
    const { root, integ } = setup();
    const w1 = createTaskWorktree(root, 'x', 1);
    const w2 = createTaskWorktree(root, 'x', 2);
    writeFileSync(join(w1, 'README.md'), 'line1\nONE\nline3\n');
    writeFileSync(join(w2, 'README.md'), 'line1\nTWO\nline3\n');
    commitAll(w1, 't1', []);
    commitAll(w2, 't2', []);
    expect(mergeTaskBranch(integ, 'wt/x/task-1')).toBe('merged');
    const head = git(integ, ['rev-parse', 'HEAD']);
    expect(mergeTaskBranch(integ, 'wt/x/task-2')).toBe('conflict');
    expect(git(integ, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(integ, ['status', '--porcelain']).trim()).toBe('');
  });

  it('undoLastMerge restores previous head', () => {
    const { root, integ } = setup();
    const before = git(integ, ['rev-parse', 'HEAD']);
    const w1 = createTaskWorktree(root, 'x', 1);
    writeFileSync(join(w1, 'a.txt'), 'a');
    commitAll(w1, 't1', []);
    mergeTaskBranch(integ, 'wt/x/task-1');
    expect(git(integ, ['rev-parse', 'HEAD'])).not.toBe(before);
    undoLastMerge(integ);
    expect(git(integ, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('dirtySnapshot detects change in main checkout', () => {
    const { root } = setup();
    const before = dirtySnapshot([root]);
    writeFileSync(join(root, 'stray.txt'), 'x');
    expect(dirtySnapshot([root])).not.toEqual(before);
  });

  it('ensureExcluded appends the pattern once', () => {
    const root = makeRepo();
    ensureExcluded(root, '.konoha/');
    ensureExcluded(root, '.konoha/');
    const file = join(root, '.git', 'info', 'exclude');
    expect(readFileSync(file, 'utf8').split('\n').filter((l) => l === '.konoha/')).toHaveLength(1);
  });

  it('mergeFeatIntoDev merges and reports conflict', () => {
    const { root, integ } = setup();
    const w1 = createTaskWorktree(root, 'x', 1);
    writeFileSync(join(w1, 'a.txt'), 'a');
    commitAll(w1, 't1', []);
    mergeTaskBranch(integ, 'wt/x/task-1');
    expect(mergeFeatIntoDev(root, 'feat/x', 'dev')).toBe('merged');
    expect(git(root, ['show', 'dev:a.txt'])).toBe('a');
    // diverge dev and feat on the same line -> conflict
    const w2 = createTaskWorktree(root, 'x', 2);
    writeFileSync(join(w2, 'README.md'), 'line1\nFEAT\nline3\n');
    commitAll(w2, 't2', []);
    mergeTaskBranch(integ, 'wt/x/task-2');
    const tmpDev = join(root, '.konoha-devtmp');
    git(root, ['worktree', 'add', tmpDev, 'dev']);
    writeFileSync(join(tmpDev, 'README.md'), 'line1\nDEV\nline3\n');
    git(tmpDev, ['commit', '-am', 'dev change']);
    git(root, ['worktree', 'remove', '--force', tmpDev]);
    expect(mergeFeatIntoDev(root, 'feat/x', 'dev')).toBe('conflict');
  });
});
