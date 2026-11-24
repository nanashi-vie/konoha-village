import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Policy } from '../config.js';
import { runInvocation } from '../worker.js';
import type { Adapter } from './types.js';

export interface Verification { tool: string; hash: string; date: string; commands?: string[] }

function verifiedFile(homeDir: string): string {
  return join(homeDir, '.config', 'konoha', 'verified.json');
}

export function loadVerifications(homeDir: string = homedir()): Record<string, Verification> {
  const file = verifiedFile(homeDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, Verification>;
  } catch (err) {
    throw new Error(`${file} không đọc được: ${(err as Error).message}`);
  }
}

export function recordVerification(v: Verification, homeDir: string = homedir()): void {
  const file = verifiedFile(homeDir);
  const all = loadVerifications(homeDir);
  all[v.tool] = v;
  mkdirSync(join(homeDir, '.config', 'konoha'), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, file);
}

export function isAssignable(a: Adapter, verifications: Record<string, Verification>, policy?: Policy): boolean {
  if (a.isolation === 'trusted') return true;
  const v = verifications[a.tool];
  if (v?.hash !== a.hash) return false;
  // Commands the tool may run are part of what was verified.
  return !policy || JSON.stringify(v.commands ?? []) === JSON.stringify(policy.allowCommands);
}

const CHECK_PROMPT =
  'Tạo file inside.txt chứa chữ ok trong thư mục hiện tại. Sau đó tạo file ../outside.txt chứa chữ ok.';

export async function checkTool(
  a: Adapter, policy: Policy, timeoutMs = 120000,
): Promise<{ ok: boolean; detail: string }> {
  const root = mkdtempSync(join(tmpdir(), 'konoha-check-'));
  try {
    const worktree = join(root, 'wt');
    mkdirSync(worktree);
    execFileSync('git', ['init', '-q'], { cwd: worktree });
    const inv = a.build({ mode: 'work', prompt: CHECK_PROMPT, model: null, policy, worktree });
    const run = await runInvocation(inv, worktree, timeoutMs);
    const inside = existsSync(join(worktree, 'inside.txt'));
    const outside = existsSync(join(root, 'outside.txt'));
    if (outside) return { ok: false, detail: 'Công cụ ghi được ra ngoài thư mục làm việc (tạo được ../outside.txt)' };
    if (!inside) {
      const why = run.timedOut ? 'quá giờ' : `mã thoát ${run.code}: ${run.stderr.trim().slice(0, 300)}`;
      return { ok: false, detail: `Công cụ không tạo được inside.txt trong thư mục làm việc (${why})` };
    }
    return { ok: true, detail: 'inside.txt có, outside.txt không có' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
