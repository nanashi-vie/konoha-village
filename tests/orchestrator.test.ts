import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runPlan, retryTask, mergeToDev, preflightTools, type RunDeps } from '../src/orchestrator.js';
import { loadAdapters } from '../src/adapters/load.js';
import { compileTool } from '../src/adapters/definition.js';
import type { Adapter } from '../src/adapters/types.js';
import { loadState, saveState } from '../src/state/store.js';
import { readEvents } from '../src/state/events.js';
import { git } from '../src/git.js';
import { fakeAdapter, fakeDefinition } from './helpers/fakeTool.js';
import { makeRepo } from './helpers/tmpRepo.js';
import type { runReview } from '../src/review.js';

const PLAN_PATH = 'docs/superpowers/plans/2026-11-23-demo.md';
const PASS = { verdict: { verdict: 'pass' as const, notes: '', planChange: null }, model: 'rev-1' };

interface T { id: number; wait?: string; tool?: string; body?: string }
function planText(tasks: T[], status = 'đã duyệt'): string {
  const blocks = tasks.map((t) => `### Task ${t.id}: Việc ${t.id}\n**Giao cho:** ${t.tool ?? 'fake'}\n**Chờ:** ${t.wait ?? '—'}\n\n${t.body ?? ''}\n`);
  return `# Demo Implementation Plan\n**Trạng thái plan:** ${status}\n**Spec:** \`docs/spec.md\`\n\n${blocks.join('\n')}`;
}
const FOUR: T[] = [{ id: 1 }, { id: 2, wait: '1' }, { id: 3, wait: '1' }, { id: 4, wait: '2, 3' }];

function project(text: string, maxParallel = 3) {
  const root = makeRepo();
  mkdirSync(join(root, '.konoha'), { recursive: true });
  writeFileSync(join(root, '.konoha', 'config.json'), JSON.stringify({ testCommand: 'echo ok', maxParallel }));
  mkdirSync(join(root, dirname(PLAN_PATH)), { recursive: true });
  writeFileSync(join(root, PLAN_PATH), text);
  return root;
}
function deps(over: Partial<RunDeps> & { env?: Record<string, string>; fakeOpts?: { maxParallel?: number } } = {}) {
  const { env, fakeOpts, ...rest } = over;
  const adapters = new Map<string, Adapter>([
    ['fake', fakeAdapter('fake', 'write', { extraEnv: env, ...fakeOpts })],
    ['claude', fakeAdapter('claude', 'write', { review: true })],
  ]);
  const review = vi.fn(async () => PASS) as unknown as typeof runReview & ReturnType<typeof vi.fn>;
  const notify = vi.fn();
  return { adapters, verifications: {}, review, notify, which: () => true,
    home: mkdtempSync(join(tmpdir(), 'konoha-home-')), ...rest } as RunDeps & { review: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
}
const logFile = () => join(mkdtempSync(join(tmpdir(), 'konoha-log-')), 'log.jsonl');
function readLog(file: string) {
  return readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { task: string; event: string; t: number });
}
function span(log: ReturnType<typeof readLog>, task: string) {
  const mine = log.filter((l) => l.task === task);
  return { start: Math.min(...mine.filter((l) => l.event === 'start').map((l) => l.t)),
    end: Math.max(...mine.filter((l) => l.event === 'end').map((l) => l.t)) };
}
const branches = (root: string) => git(root, ['branch', '--list']);

describe('runPlan', () => {
  it('happy path ends awaiting_merge with 4 merges and dev untouched', async () => {
    const root = project(planText(FOUR));
    const d = deps();
    const devBefore = (() => { try { return git(root, ['rev-parse', 'dev']); } catch { return null; } })();
    const state = await runPlan(root, PLAN_PATH, d);
    expect(state.status).toBe('awaiting_merge');
    expect(Object.values(state.tasks).every((t) => t.status === 'merged')).toBe(true);
    expect(git(root, ['log', 'feat/demo', '--merges', '--oneline']).trim().split('\n')).toHaveLength(4);
    expect(git(root, ['rev-parse', 'dev']).trim()).toBe(git(root, ['rev-parse', 'main']).trim());
    expect(devBefore).toBeNull();
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('runs independent tasks in parallel and waits for dependencies', async () => {
    const log = logFile();
    const root = project(planText(FOUR));
    await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log, FAKE_DELAY_MS: '400' } }));
    const l = readLog(log);
    const [s2, s3, s4] = [span(l, '2'), span(l, '3'), span(l, '4')];
    expect(s2.start).toBeLessThan(s3.end);
    expect(s3.start).toBeLessThan(s2.end);
    expect(s4.start).toBeGreaterThanOrEqual(Math.max(s2.end, s3.end));
  });

  it('respects per-tool maxParallel', async () => {
    const log = logFile();
    const root = project(planText(FOUR));
    await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log, FAKE_DELAY_MS: '300' }, fakeOpts: { maxParallel: 1 } }));
    const l = readLog(log);
    const [s2, s3] = [span(l, '2'), span(l, '3')];
    expect(s2.end <= s3.start || s3.end <= s2.start).toBe(true);
  });

  it('keeps other branches running when a task is blocked', async () => {
    const tasks = [...FOUR]; tasks[1] = { id: 2, wait: '1', body: 'FAKE_MODE=block' };
    const root = project(planText(tasks));
    const state = await runPlan(root, PLAN_PATH, deps());
    expect(state.tasks[2]).toMatchObject({ status: 'blocked', block: { kind: 'needs_library' } });
    expect(state.tasks[3].status).toBe('merged');
    expect(state.tasks[4].status).toBe('pending');
    expect(state.status).toBe('needs_user');
  });

  it('retries a failing review twice then blocks with review_limit', async () => {
    const log = logFile();
    const root = project(planText([{ id: 1 }]));
    const d = deps({ env: { FAKE_LOG: log } });
    d.review = vi.fn(async () => ({ verdict: { verdict: 'fail' as const, notes: 'sai', planChange: null }, model: null })) as never;
    const state = await runPlan(root, PLAN_PATH, d);
    expect(readLog(log).filter((l) => l.event === 'start')).toHaveLength(3);
    expect(state.tasks[1].block?.kind).toBe('review_limit');
  });

  it('blocks on plan_change without touching the plan file', async () => {
    const text = planText([{ id: 1 }]);
    const root = project(text);
    const d = deps();
    d.review = vi.fn(async () => ({ verdict: { verdict: 'fail' as const, notes: 'x', planChange: 'tách task' }, model: null })) as never;
    const state = await runPlan(root, PLAN_PATH, d);
    expect(state.tasks[1].block?.kind).toBe('plan_change');
    expect(readFileSync(join(root, PLAN_PATH), 'utf8')).toBe(text);
  });

  it('blocks one task on merge conflict and leaves integration clean', async () => {
    const tasks: T[] = [{ id: 1 }, { id: 2, wait: '1', body: 'FAKE_MODE=conflict' }, { id: 3, wait: '1', body: 'FAKE_MODE=conflict' }];
    const root = project(planText(tasks));
    const state = await runPlan(root, PLAN_PATH, deps());
    const kinds = [2, 3].map((id) => state.tasks[id].status === 'merged' ? 'merged' : state.tasks[id].block?.kind);
    expect(kinds.sort()).toEqual(['merge_conflict', 'merged']);
    expect(git(join(root, '.konoha', 'worktrees', 'demo', '_integration'), ['status', '--porcelain']).trim()).toBe('');
  });

  it('preflight rejects unknown, unverified and missing-binary tools with one error and no branches', async () => {
    const tasks: T[] = [{ id: 1, tool: 'ghost' }, { id: 2, tool: 'unverified' }, { id: 3, tool: 'nowhere' }];
    const root = project(planText(tasks));
    const d = deps();
    d.adapters!.set('unverified', fakeAdapter('unverified', 'write', { isolation: 'verify' }));
    d.adapters!.set('nowhere', compileTool('nowhere', { ...fakeDefinition('write'), binary: 'missing-bin' }));
    d.which = (b: string) => b !== 'missing-bin';
    const err = await runPlan(root, PLAN_PATH, d).then(() => '', (e: Error) => e.message);
    for (const s of ['không được hỗ trợ', 'chưa xác minh cách ly', 'không tìm thấy lệnh']) expect(err).toContain(s);
    expect(branches(root)).not.toContain('dev');
    expect(branches(root)).not.toContain('feat/demo');
  });

  it('blocks with tool_unavailable when the tool disappears mid-run', async () => {
    const root = project(planText(FOUR));
    const d = deps();
    let calls = 0;
    d.which = () => calls++ < 2; // preflight checks fake and claude once each
    const state = await runPlan(root, PLAN_PATH, d);
    expect(state.tasks[1].block?.kind).toBe('tool_unavailable');
    expect(state.status).toBe('needs_user');
  });

  it('resumes after a crash without re-running merged tasks', async () => {
    const log = logFile();
    const tasks = [...FOUR]; tasks[1] = { id: 2, wait: '1', body: 'FAKE_MODE=block' };
    const root = project(planText(tasks));
    await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log } }));
    writeFileSync(join(root, PLAN_PATH), planText(FOUR));
    const s = loadState(root, 'demo')!;
    s.tasks[2] = { status: 'running', attempts: 0, block: null };
    s.status = 'running';
    saveState(root, s);
    const before = readLog(log).filter((l) => l.event === 'start').map((l) => l.task);
    expect(before.sort()).toEqual(['1', '2', '3']);
    const state = await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log } }));
    const after = readLog(log).filter((l) => l.event === 'start').map((l) => l.task).slice(before.length).sort();
    expect(after).toEqual(['2', '4']);
    expect(state.status).toBe('awaiting_merge');
  });

  it('rejects an unapproved plan before creating branches', async () => {
    const root = project(planText([{ id: 1 }], 'nháp'));
    await expect(runPlan(root, PLAN_PATH, deps())).rejects.toThrow(/Plan chưa được duyệt/);
    expect(branches(root)).not.toContain('dev');
  });

  it('writes the expected events', async () => {
    const root = project(planText(FOUR));
    await runPlan(root, PLAN_PATH, deps());
    const events = readEvents(root, 'demo');
    const types = new Set(events.map((e) => e.type));
    for (const t of ['run_started', 'task_started', 'review_passed', 'task_merged', 'run_awaiting_merge']) expect(types.has(t as never)).toBe(true);
    expect(events.every((e) => e.run === 'demo')).toBe(true);
    expect(events.find((e) => e.type === 'review_passed')?.role).toBe('judge');
  });

  it('records tool_overridden when a repo file shadows a built-in', async () => {
    const root = project(planText([{ id: 1, tool: 'claude' }]));
    mkdirSync(join(root, '.konoha', 'tools'), { recursive: true });
    writeFileSync(join(root, '.konoha', 'tools', 'claude.json'),
      JSON.stringify(fakeDefinition('write', { review: true, isolation: 'verify' })));
    const d = deps();
    delete d.adapters;
    // a repo override only keeps working after the user verified it
    d.verifications = { claude: { tool: 'claude', hash: loadAdapters(root, d.home).adapters.get('claude')!.hash, date: 'x' } };
    await runPlan(root, PLAN_PATH, d);
    expect(readEvents(root, 'demo').some((e) => e.type === 'tool_overridden' && e.summary.includes('claude'))).toBe(true);
  });
});

describe('mergeToDev / retryTask', () => {
  it('merges feat into dev when awaiting_merge and refuses otherwise', async () => {
    const root = project(planText(FOUR));
    await runPlan(root, PLAN_PATH, deps());
    expect(mergeToDev(root, 'demo')).toBe('merged');
    expect(git(root, ['show', 'dev:inside.txt'])).toBe('ok');
    expect(loadState(root, 'demo')!.status).toBe('merged_to_dev');

    const tasks = [...FOUR]; tasks[1] = { id: 2, wait: '1', body: 'FAKE_MODE=block' };
    const root2 = project(planText(tasks));
    await runPlan(root2, PLAN_PATH, deps());
    expect(mergeToDev(root2, 'demo')).toBe('not_ready');
  });

  it('retryTask resets a blocked task', async () => {
    const root = project(planText([{ id: 1, body: 'FAKE_MODE=block' }]));
    await runPlan(root, PLAN_PATH, deps());
    retryTask(root, 'demo', 1);
    expect(loadState(root, 'demo')!.tasks[1]).toEqual({ status: 'pending', attempts: 0, block: null });
    expect(() => retryTask(root, 'demo', 9)).toThrow(/Không có task/);
  });
});

describe('preflightTools', () => {
  it('lists load errors and missing review capability', () => {
    const plan = { path: 'p', slug: 'p', title: '', approved: true, libraries: [],
      tasks: [{ id: 1, name: 'a', tool: 'fake', model: null, waitsOn: [], files: [], body: '' }] };
    const adapters = new Map([['fake', fakeAdapter('fake', 'write')]]);
    const errs = preflightTools(plan, adapters, {}, () => true, [{ tool: 'fake', message: 'hỏng' }]);
    expect(errs).toContain('File công cụ "fake" lỗi: hỏng');
    expect(errs).toContain('Review cần công cụ "claude" có chế độ review');
  });
});

describe('resume and run safety', () => {
  it('adds tasks that appear in an edited plan (I5)', async () => {
    const root = project(planText([{ id: 1 }]));
    await runPlan(root, PLAN_PATH, deps());
    writeFileSync(join(root, PLAN_PATH), planText([{ id: 1 }, { id: 2, wait: '1' }]));
    const state = await runPlan(root, PLAN_PATH, deps());
    expect(state.tasks[2].status).toBe('merged');
    expect(state.status).toBe('awaiting_merge');
  });

  it('refuses a second concurrent run but ignores a stale lock (I1)', async () => {
    const root = project(planText([{ id: 1 }]));
    const lock = join(root, '.konoha', 'runs', 'demo', 'lock');
    mkdirSync(join(lock, '..'), { recursive: true });
    writeFileSync(lock, String(process.pid));
    await expect(runPlan(root, PLAN_PATH, deps())).rejects.toThrow(/đang chạy/);
    writeFileSync(lock, '999999');
    await expect(runPlan(root, PLAN_PATH, deps())).resolves.toBeDefined();
  });

  it('repairs integration and adopts a merge that was never recorded (I2)', async () => {
    const log = logFile();
    const root = project(planText([{ id: 1 }]));
    await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log } }));
    const integ = join(root, '.konoha', 'worktrees', 'demo', '_integration');
    git(root, ['branch', 'wt/demo/task-1', git(root, ['rev-parse', 'feat/demo^2']).trim()]);
    writeFileSync(join(integ, 'junk.txt'), 'leftover');
    const s = loadState(root, 'demo')!;
    s.tasks[1] = { status: 'pending', attempts: 0, block: null };
    s.status = 'running';
    saveState(root, s);
    const state = await runPlan(root, PLAN_PATH, deps({ env: { FAKE_LOG: log } }));
    expect(state.tasks[1].status).toBe('merged');
    expect(readLog(log).filter((l) => l.event === 'start')).toHaveLength(1);
    expect(git(integ, ['status', '--porcelain']).trim()).toBe('');
  });
});
