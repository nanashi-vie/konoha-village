import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installLibraries } from '../src/deps.js';
import { ensureBranches, ensureExcluded, git, integrationWorktree } from '../src/git.js';
import { makeRepo } from './helpers/tmpRepo.js';

function integ() {
  const root = makeRepo();
  ensureExcluded(root, '.konoha/');
  ensureBranches(root, 'main', 'dev', 'feat/x');
  return integrationWorktree(root, 'x');
}
const count = (wt: string) => Number(git(wt, ['rev-list', '--count', 'HEAD']).trim());

describe('installLibraries', () => {
  it('runs commands and commits the result', () => {
    const wt = integ(); const before = count(wt);
    installLibraries(wt, ['echo a > lib.txt']);
    expect(existsSync(join(wt, 'lib.txt'))).toBe(true);
    expect(count(wt)).toBe(before + 1);
    expect(git(wt, ['show', '--name-only', '--format=', 'HEAD'])).toContain('lib.txt');
  });
  it('does nothing for an empty list', () => {
    const wt = integ(); const before = count(wt);
    installLibraries(wt, []);
    expect(count(wt)).toBe(before);
  });
  it('throws naming the failing command', () => {
    expect(() => installLibraries(integ(), ['false'])).toThrow(/false/);
  });
});
