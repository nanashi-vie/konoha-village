import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, Invocation, WorkerJob } from './adapters/types.js';
import { commitAll, dirtySnapshot, git } from './git.js';
import type { Plan, PlanTask } from './plan/parse.js';
import type { BlockKind } from './state/store.js';

export interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }

export const BLOCKED_MARKER = '.konoha-blocked.json';

export function runInvocation(inv: Invocation, cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const child = spawn(inv.cmd, inv.args, {
      cwd, env: { ...process.env, ...inv.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (err) => {
      stderr += err.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

export function buildBrief(plan: Plan, task: PlanTask, specPath: string, reviewNotes: string | null): string {
  const lines = [
    `# Việc ${task.id}: ${task.name}`,
    '',
    `Spec: ${specPath}`,
    `Plan: ${plan.path}`,
    '',
    '## Nội dung việc',
    task.body,
    '',
    '## Files liên quan',
    ...(task.files.length ? task.files.map((f) => `- ${f}`) : ['- (không nêu)']),
    '',
    '## Luật bắt buộc',
    '- Chỉ đọc và sửa file trong thư mục hiện tại (worktree của bạn).',
    '- Không cài gói, không gọi mạng, không chạy git (không commit, không push, không gộp).',
    '- Chỉ chạy các lệnh đã được cho phép.',
    `- Nếu cần quyền, cần thêm thư viện, hoặc cần đổi plan: ghi file ${BLOCKED_MARKER} ở thư mục hiện tại với nội dung`,
    '  {"kind":"needs_permission"|"needs_library"|"plan_change","detail":"<lý do>"} rồi dừng ngay.',
  ];
  if (reviewNotes) {
    lines.push('', '## Nhận xét review lần trước (cần sửa)', reviewNotes);
  }
  return lines.join('\n');
}

export interface WorkerResult {
  outcome: 'changed' | 'no_changes' | 'blocked' | 'timeout' | 'error' | 'outside_write';
  block: { kind: BlockKind; detail: string } | null;
  stdout: string;
  model: string | null;
  testOutput: string;
}

const MARKER_KINDS: BlockKind[] = ['needs_permission', 'needs_library', 'plan_change'];

function readMarker(worktree: string): { kind: BlockKind; detail: string } | null {
  const file = join(worktree, BLOCKED_MARKER);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string; detail?: string };
    const kind = MARKER_KINDS.includes(raw.kind as BlockKind) ? (raw.kind as BlockKind) : 'worker_error';
    return { kind, detail: String(raw.detail ?? '') };
  } catch {
    return { kind: 'worker_error', detail: `${BLOCKED_MARKER} không đọc được` };
  }
}

function hasChanges(worktree: string): boolean {
  return git(worktree, ['status', '--porcelain', '--', '.', `:(exclude)${BLOCKED_MARKER}`]).trim() !== '';
}

export async function runWorker(opts: {
  adapter: Adapter; job: WorkerJob; guardPaths: string[]; timeoutMs: number;
  testCommand: string; commitMessage: string;
}): Promise<WorkerResult> {
  const { adapter, job } = opts;
  const before = dirtySnapshot(opts.guardPaths);
  const inv = adapter.build(job);
  const run = await runInvocation(inv, job.worktree, opts.timeoutMs);
  const after = dirtySnapshot(opts.guardPaths);
  const model = adapter.actualModel(run.stdout);
  const result = (outcome: WorkerResult['outcome'], block: WorkerResult['block'] = null, testOutput = ''): WorkerResult =>
    ({ outcome, block, stdout: run.stdout, model, testOutput });

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    return result('outside_write', { kind: 'outside_write', detail: 'Worker đã thay đổi file ngoài worktree' });
  }
  if (run.timedOut) return result('timeout', { kind: 'timeout', detail: `Quá ${Math.round(opts.timeoutMs / 1000)} giây` });
  const marker = readMarker(job.worktree);
  if (marker) return result('blocked', marker);
  if (run.code !== 0 && !hasChanges(job.worktree)) {
    return result('error', { kind: 'worker_error', detail: `Mã thoát ${run.code}: ${run.stderr.trim().slice(0, 500)}` });
  }
  if (!commitAll(job.worktree, opts.commitMessage, [BLOCKED_MARKER])) {
    return result('no_changes', { kind: 'no_changes', detail: 'Worker không sửa gì' });
  }
  const tests = spawnSync(opts.testCommand, {
    cwd: job.worktree, shell: true, encoding: 'utf8', timeout: opts.timeoutMs,
  });
  const testOutput = `${tests.stdout ?? ''}${tests.stderr ?? ''}`.slice(-20000);
  return result('changed', null, testOutput);
}
