import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plan } from '../plan/parse.js';

export type TaskStatus = 'pending' | 'running' | 'merged' | 'blocked';
export type BlockKind =
  | 'needs_permission' | 'needs_library' | 'plan_change' | 'review_limit'
  | 'merge_conflict' | 'tests_failed_after_merge' | 'tool_unavailable' | 'outside_write'
  | 'timeout' | 'no_changes' | 'worker_error';
export interface TaskState {
  status: TaskStatus;
  attempts: number;
  block: { kind: BlockKind; detail: string } | null;
}
export type RunStatus = 'running' | 'awaiting_merge' | 'needs_user' | 'merged_to_dev';
export interface RunState {
  slug: string;
  planPath: string;
  status: RunStatus;
  librariesInstalled: boolean;
  tasks: Record<number, TaskState>;
}

export function runDir(repoRoot: string, slug: string): string {
  return join(repoRoot, '.konoha', 'runs', slug);
}

export function initState(plan: Plan): RunState {
  const tasks: Record<number, TaskState> = {};
  for (const t of plan.tasks) tasks[t.id] = { status: 'pending', attempts: 0, block: null };
  return { slug: plan.slug, planPath: plan.path, status: 'running', librariesInstalled: false, tasks };
}

export function loadState(repoRoot: string, slug: string): RunState | null {
  const file = join(runDir(repoRoot, slug), 'state.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RunState;
  } catch (err) {
    throw new Error(`${file} không đọc được: ${(err as Error).message}`);
  }
}

export function saveState(repoRoot: string, state: RunState): void {
  const dir = runDir(repoRoot, state.slug);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

export function recoverInterrupted(state: RunState): number[] {
  const changed: number[] = [];
  for (const [id, t] of Object.entries(state.tasks)) {
    if (t.status === 'running') {
      t.status = 'pending';
      changed.push(Number(id));
    }
  }
  return changed;
}
