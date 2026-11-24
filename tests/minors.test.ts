import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTool, type ToolDefinition } from '../src/adapters/definition.js';
import { isAssignable, loadVerifications } from '../src/adapters/verify.js';
import { loadState } from '../src/state/store.js';
import { runReview, ReviewError } from '../src/review.js';
import { runWorker } from '../src/worker.js';
import { createTaskWorktree, ensureBranches, ensureExcluded, git, mergeFeatIntoDev } from '../src/git.js';
import { fakeAdapter, fakeDefinition } from './helpers/fakeTool.js';
import { makeRepo } from './helpers/tmpRepo.js';
import type { Plan, PlanTask } from '../src/plan/parse.js';

const base: ToolDefinition = { binary: 'x', modes: { work: { args: ['{prompt}'] } } };

describe('M3 definition validation', () => {
  it('rejects placeholders in binary, bad maxParallel, bad field types', () => {
    expect(() => compileTool('t', { ...base, binary: 'x{foo}' }, '/h')).toThrow(/binary/);
    expect(() => compileTool('t', { ...base, maxParallel: 0 }, '/h')).toThrow(/maxParallel/);
    expect(() => compileTool('t', { ...base, modes: { work: { args: 'nope' as never } } }, '/h')).toThrow(/args/);
    expect(() => compileTool('t', { ...base, env: { A: 5 as never } }, '/h')).toThrow(/env/);
  });
});

describe('M7 corrupt files', () => {
  it('name the file in the error', () => {
    const root = mkdtempSync(join(tmpdir(), 'konoha-bad-'));
    mkdirSync(join(root, '.konoha', 'runs', 'demo'), { recursive: true });
    writeFileSync(join(root, '.konoha', 'runs', 'demo', 'state.json'), '{oops');
    expect(() => loadState(root, 'demo')).toThrow(/state\.json/);
    const home = mkdtempSync(join(tmpdir(), 'konoha-bad-'));
    mkdirSync(join(home, '.config', 'konoha'), { recursive: true });
    writeFileSync(join(home, '.config', 'konoha', 'verified.json'), '{oops');
    expect(() => loadVerifications(home)).toThrow(/verified\.json/);
  });
});

describe('M9 verification covers allowCommands', () => {
  it('requires re-verification when the allowed commands change', () => {
    const a = fakeAdapter('fake', 'write', { isolation: 'verify' });
    const v = { fake: { tool: 'fake', hash: a.hash, date: 'x', commands: ['npm test'] } };
    expect(isAssignable(a, v, { allowCommands: ['npm test'] })).toBe(true);
    expect(isAssignable(a, v, { allowCommands: ['npm test', 'bash'] })).toBe(false);
    expect(isAssignable(a, { fake: { tool: 'fake', hash: a.hash, date: 'x' } }, { allowCommands: ['npm test'] })).toBe(false);
    expect(isAssignable(a, v)).toBe(true);
  });
});

const task: PlanTask = { id: 1, name: 'T', tool: 'x', model: null, waitsOn: [], files: [], body: '' };
const plan: Plan = { path: 'p', slug: 'x', title: '', approved: true, libraries: [], tasks: [task] };

describe('M4 review failures are typed', () => {
  async function review(adapter = fakeAdapter('fake', 'hang', { review: true }), timeoutMs = 500) {
    const root = makeRepo(); ensureExcluded(root, '.konoha/'); ensureBranches(root, 'main', 'dev', 'feat/x');
    const wt = createTaskWorktree(root, 'x', 1);
    return runReview({ adapter, worktree: wt, plan, task, specPath: 's', featBranch: 'feat/x', testOutput: '',
      reviewModel: 'opus', policy: { allowCommands: [] }, timeoutMs });
  }
  it('timeout', async () => {
    await expect(review()).rejects.toMatchObject({ kind: 'timeout' });
    await expect(review()).rejects.toBeInstanceOf(ReviewError);
  });
  it('missing binary', async () => {
    const gone = compileTool('gone', { ...fakeDefinition('write', { review: true }), binary: '/no/such/binary' }, '/h');
    await expect(review(gone, 5000)).rejects.toMatchObject({ kind: 'tool_unavailable' });
  });
});

describe('M5 non-zero exit with changes', () => {
  it('is an error and nothing is committed', async () => {
    const root = makeRepo(); ensureExcluded(root, '.konoha/'); ensureBranches(root, 'main', 'dev', 'feat/x');
    const wt = createTaskWorktree(root, 'x', 1);
    const before = git(wt, ['rev-list', '--count', 'HEAD']);
    const r = await runWorker({ adapter: fakeAdapter('f', 'writecrash'),
      job: { worktree: wt, prompt: 'go', model: null, policy: { allowCommands: [] }, mode: 'work' },
      guardPaths: [root], timeoutMs: 20000, testCommand: 'true', commitMessage: 'm' });
    expect(r.outcome).toBe('error');
    expect(git(wt, ['rev-list', '--count', 'HEAD'])).toBe(before);
  });
});

describe('M10 merge into dev', () => {
  it('refuses when dev is checked out with uncommitted changes', () => {
    const root = makeRepo(); ensureBranches(root, 'main', 'dev', 'feat/x');
    git(root, ['checkout', 'dev']);
    writeFileSync(join(root, 'README.md'), 'changed locally\n');
    expect(() => mergeFeatIntoDev(root, 'feat/x', 'dev')).toThrow(/chưa commit/);
  });
});
