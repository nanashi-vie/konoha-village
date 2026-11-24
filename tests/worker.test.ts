import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runInvocation, runWorker, buildBrief, BLOCKED_MARKER,
} from '../src/worker.js';
import { createTaskWorktree, ensureBranches, ensureExcluded, git } from '../src/git.js';
import { fakeAdapter } from './helpers/fakeTool.js';
import { makeRepo } from './helpers/tmpRepo.js';
import type { Plan, PlanTask } from '../src/plan/parse.js';

function setup() {
  const root = makeRepo();
  ensureExcluded(root, '.konoha/');
  ensureBranches(root, 'main', 'dev', 'feat/x');
  return { root, wt: createTaskWorktree(root, 'x', 1) };
}
const jobFor = (wt: string) => ({ worktree: wt, prompt: 'go', model: null, policy: { allowCommands: [] }, mode: 'work' as const });
const count = (wt: string) => Number(git(wt, ['rev-list', '--count', 'HEAD']).trim());

describe('runWorker', () => {
  const run = (mode: string, extra: Partial<Parameters<typeof runWorker>[0]> = {}, extraEnv: Record<string, string> = {}) => {
    const { root, wt } = setup();
    const before = count(wt);
    const promise = runWorker({
      adapter: fakeAdapter('fake', mode, { extraEnv: { FAKE_OUTSIDE_DIR: root, ...extraEnv } }),
      job: jobFor(wt), guardPaths: [root], timeoutMs: 20000, testCommand: 'echo tests-ok', commitMessage: 'task 1', ...extra,
    });
    return { root, wt, before, promise };
  };

  it('write -> changed with one new commit and test output', async () => {
    const { wt, before, promise } = run('write');
    const r = await promise;
    expect(r.outcome).toBe('changed');
    expect(count(wt)).toBe(before + 1);
    expect(r.testOutput).toContain('tests-ok');
    expect(r.model).toBe('fake-model-1');
  });
  it('none -> no_changes without new commit', async () => {
    const { wt, before, promise } = run('none');
    expect((await promise).outcome).toBe('no_changes');
    expect(count(wt)).toBe(before);
  });
  it('hang -> timeout quickly and process killed', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'konoha-pid-')), 'pid');
    const started = Date.now();
    const { promise } = run('hang', { timeoutMs: 500 }, { FAKE_PID_FILE: pidFile });
    const r = await promise;
    expect(r.outcome).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(3000 + 2000);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('block -> blocked, marker not committed', async () => {
    const { wt, promise } = run('block');
    const r = await promise;
    expect(r.outcome).toBe('blocked');
    expect(r.block?.kind).toBe('needs_library');
    expect(git(wt, ['log', '--name-only', '--format=']).includes(BLOCKED_MARKER)).toBe(false);
  });
  it('outside -> outside_write', async () => {
    const { promise } = run('outside');
    expect((await promise).outcome).toBe('outside_write');
  });
  it('crash without changes -> error', async () => {
    const { promise } = run('crash');
    expect((await promise).outcome).toBe('error');
  });
});

describe('runInvocation', () => {
  it('captures code and stdout', async () => {
    const { wt } = setup();
    const inv = fakeAdapter('fake', 'write').build(jobFor(wt));
    const r = await runInvocation(inv, wt, 20000);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"result":"done"');
    expect(existsSync(join(wt, 'inside.txt'))).toBe(true);
  });
  it('times out hung processes', async () => {
    const { wt } = setup();
    const inv = fakeAdapter('fake', 'hang').build(jobFor(wt));
    expect((await runInvocation(inv, wt, 500)).timedOut).toBe(true);
  });
});

describe('buildBrief', () => {
  const task: PlanTask = { id: 1, name: 'Tạo bảng', tool: 'claude', model: null, waitsOn: [], files: ['src/a.ts'], body: '### Task 1: Tạo bảng\nnội dung' };
  const plan: Plan = { path: 'docs/plan.md', slug: 'p', title: 'P', approved: true, libraries: [], tasks: [task] };
  it('contains task name, spec path, marker and review notes', () => {
    const brief = buildBrief(plan, task, 'docs/spec.md', 'sửa lại chỗ X');
    expect(brief).toContain('Tạo bảng');
    expect(brief).toContain('docs/spec.md');
    expect(brief).toContain(BLOCKED_MARKER);
    expect(brief).toContain('sửa lại chỗ X');
    expect(buildBrief(plan, task, 'docs/spec.md', null)).not.toContain('sửa lại chỗ X');
  });
});
