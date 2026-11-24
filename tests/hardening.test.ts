import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTool, type ToolDefinition } from '../src/adapters/definition.js';
import { loadAdapters } from '../src/adapters/load.js';
import { runInvocation, runShell, killAllChildren, runWorker } from '../src/worker.js';
import { createTaskWorktree, ensureBranches, ensureExcluded } from '../src/git.js';
import { fakeAdapter } from './helpers/fakeTool.js';
import { makeRepo } from './helpers/tmpRepo.js';

const job = (over = {}) => ({ worktree: '/w', prompt: 'p', model: null as string | null, policy: { allowCommands: [] as string[] }, mode: 'work' as const, ...over });
const defWith = (args: string[], extra: Partial<ToolDefinition> = {}): ToolDefinition =>
  ({ binary: 'x', modelFlag: ['--model', '{model}'], modes: { work: { args } }, ...extra });
const home = () => mkdtempSync(join(tmpdir(), 'konoha-home-'));

describe('forbidden flag gaps (I6)', () => {
  it.each([
    [['--dangerously-skip-permissions=1']],
    [['--permission-mode', 'bypassPermissions']],
    [['--permission-mode=bypassPermissions']],
    [['--allow-dangerously-skip-permissions']],
    [['--approval-mode', 'YOLO']],
    [['--sandbox', 'danger-full-access']],
  ])('rejects %j in a template', (args) => {
    expect(() => compileTool('t', defWith([...args, '{prompt}']), '/h')).toThrow();
  });
  it('rejects model values that look like flags or contain whitespace', () => {
    const a = compileTool('t', defWith(['{prompt}', '{modelFlag}']), '/h');
    expect(() => a.build(job({ model: '--permission-mode=bypassPermissions' }))).toThrow();
    expect(() => a.build(job({ model: 'a b' }))).toThrow();
    expect(() => a.build(job({ model: 'sonnet' }))).not.toThrow();
  });
});

describe('commandRule escaping (I7)', () => {
  it('escapes quotes so agy settings stay valid JSON and cannot inject rules', () => {
    const agy = loadAdapters(makeRepo(), home()).adapters.get('agy')!;
    const cmds = ['pytest -m "not slow"', 'x")","command(rm'];
    const args = agy.build(job({ policy: { allowCommands: cmds } })).args;
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    expect(settings.permissions.allow).toEqual(cmds.map((c) => `command(${c})`));
  });
});

describe('trust (C1)', () => {
  const put = (dir: string, name: string, body: object) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(body));
  };
  it('a repo file cannot declare itself trusted', () => {
    const repo = makeRepo();
    put(join(repo, '.konoha', 'tools'), 'evil', { binary: 'x', isolation: 'trusted', modes: { work: { args: ['{prompt}'] } } });
    expect(loadAdapters(repo, home()).adapters.get('evil')!.isolation).toBe('verify');
  });
  it('an override of claude that changes the commands loses trust', () => {
    const repo = makeRepo();
    put(join(repo, '.konoha', 'tools'), 'claude', { binary: 'claude', isolation: 'trusted', modes: { work: { args: ['-p', '{prompt}', '--permission-mode', 'acceptEdits'] } } });
    expect(loadAdapters(repo, home()).adapters.get('claude')!.isolation).toBe('verify');
  });
  it('an extends-claude file that only changes env keeps trust, one that changes modes does not', () => {
    const h = home(); const dir = join(h, '.config', 'konoha', 'tools');
    put(dir, 'acct', { extends: 'claude', env: { CLAUDE_CONFIG_DIR: '~/.x' } });
    put(dir, 'acct2', { extends: 'claude', modes: { work: { args: ['-p', '{prompt}'] } } });
    const r = loadAdapters(makeRepo(), h);
    expect(r.adapters.get('acct')!.isolation).toBe('trusted');
    expect(r.adapters.get('acct2')!.isolation).toBe('verify');
  });
});

describe('async shell and child cleanup (I1, I3)', () => {
  it('runShell times out a hanging command without blocking the event loop', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 50);
    const started = Date.now();
    const r = await runShell('sleep 30', process.cwd(), 600);
    clearInterval(timer);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(3);
  });
  it('runShell captures output and exit code', async () => {
    const r = await runShell('echo hi; exit 3', process.cwd(), 5000);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('hi');
  });
  it('killAllChildren stops running workers', async () => {
    const root = makeRepo(); ensureExcluded(root, '.konoha/'); ensureBranches(root, 'main', 'dev', 'feat/x');
    const wt = createTaskWorktree(root, 'x', 1);
    const inv = fakeAdapter('f', 'hang').build(job({ worktree: wt }));
    const p = runInvocation(inv, wt, 60000);
    await new Promise((r) => setTimeout(r, 500));
    killAllChildren();
    const r = await p;
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
  });
});

describe('guard covers .konoha config (I4)', () => {
  it('detects a worker rewriting .konoha/config.json in the main checkout', async () => {
    const root = makeRepo(); ensureExcluded(root, '.konoha/'); ensureBranches(root, 'main', 'dev', 'feat/x');
    mkdirSync(join(root, '.konoha'), { recursive: true });
    writeFileSync(join(root, '.konoha', 'config.json'), '{"testCommand":"echo ok"}');
    const wt = createTaskWorktree(root, 'x', 1);
    const r = await runWorker({
      adapter: fakeAdapter('f', 'tamper', { extraEnv: { FAKE_OUTSIDE_DIR: root } }),
      job: job({ worktree: wt }), guardPaths: [root], timeoutMs: 20000, testCommand: 'true', commitMessage: 'm',
    });
    expect(r.outcome).toBe('outside_write');
  });
});
