import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { isAssignable, loadVerifications, type Verification } from './adapters/verify.js';
import { loadAdapters } from './adapters/load.js';
import type { Adapter } from './adapters/types.js';
import { loadConfig, loadPolicy, type Config, type Policy } from './config.js';
import { installLibraries } from './deps.js';
import {
  createTaskWorktree, ensureBranches, ensureExcluded, integrationWorktree, mergeFeatIntoDev,
  mergeTaskBranch, removeTaskWorktree, undoLastMerge, git,
} from './git.js';
import { notifyUser } from './notify.js';
import { parsePlan, type Plan, type PlanTask } from './plan/parse.js';
import { validatePlan } from './plan/validate.js';
import { ReviewError, runReview } from './review.js';
import { nextRunnable } from './scheduler.js';
import { runDir } from './state/store.js';
import { appendEvent, type EventType } from './state/events.js';
import {
  initState, loadState, recoverInterrupted, saveState, type BlockKind, type RunState,
} from './state/store.js';
import { buildBrief, installSignalHandlers, runShell, runWorker } from './worker.js';

export interface RunDeps {
  review?: typeof runReview;
  notify?: typeof notifyUser;
  which?: (bin: string) => boolean;
  adapters?: Map<string, Adapter>;
  verifications?: Record<string, Verification>;
  home?: string;
}

export function defaultWhich(bin: string): boolean {
  if (bin.includes('/')) return existsSync(bin);
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function preflightTools(
  plan: Plan, adapters: Map<string, Adapter>, verifications: Record<string, Verification>,
  which: (bin: string) => boolean, loadErrors: { tool: string; message: string }[],
  policy?: Policy, reviewModel?: string,
): string[] {
  const errors: string[] = [];
  const tools = [...new Set([...plan.tasks.map((t) => t.tool).filter((t) => t !== ''), 'claude'])];
  for (const name of tools) {
    const err = loadErrors.find((e) => e.tool === name);
    if (err) {
      errors.push(`File công cụ "${name}" lỗi: ${err.message}`);
      continue;
    }
    const adapter = adapters.get(name);
    if (!adapter) continue; // validatePlan reports unknown tools; claude is checked below
    if (!isAssignable(adapter, verifications, policy)) {
      errors.push(`Công cụ "${name}" chưa xác minh cách ly: chạy konoha tool check ${name}`);
    }
    if (!which(adapter.binary)) errors.push(`Công cụ "${name}": không tìm thấy lệnh "${adapter.binary}" trên máy`);
  }
  const claude = adapters.get('claude');
  if (!claude || !claude.hasMode('review')) errors.push('Review cần công cụ "claude" có chế độ review');
  // Dry-run the command builder so forbidden flags and bad model names fail now, not mid-run.
  const dry = { prompt: '', worktree: '/', policy: policy ?? { allowCommands: [] } };
  for (const t of plan.tasks) {
    const a = adapters.get(t.tool);
    if (!a) continue;
    try { a.build({ ...dry, mode: 'work', model: t.model }); } catch (err) { errors.push(`Task ${t.id}: ${(err as Error).message}`); }
  }
  if (claude?.hasMode('review') && reviewModel !== undefined) {
    try { claude.build({ ...dry, mode: 'review', model: reviewModel }); } catch (err) { errors.push(`Review: ${(err as Error).message}`); }
  }
  return errors;
}

function findSpecPath(markdown: string): string {
  return /\*\*Spec:\*\*\s*`?([^`\s]+)`?/.exec(markdown)?.[1] ?? '(plan không nêu spec)';
}

const BLOCK_FOR_OUTCOME: Record<string, BlockKind> = {
  timeout: 'timeout', no_changes: 'no_changes', error: 'worker_error', outside_write: 'outside_write',
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runPlan(repoRoot: string, planPath: string, deps: RunDeps = {}): Promise<RunState> {
  installSignalHandlers();
  const absPlan = isAbsolute(planPath) ? planPath : resolve(repoRoot, planPath);
  const slug = parsePlan(readFileSync(absPlan, 'utf8'), planPath).slug;
  const lock = join(runDir(repoRoot, slug), 'lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (Number.isInteger(pid) && pidAlive(pid)) throw new Error(`Plan "${slug}" đang chạy (pid ${pid})`);
  }
  const acquire = () => {
    mkdirSync(runDir(repoRoot, slug), { recursive: true });
    writeFileSync(lock, String(process.pid));
  };
  try {
    return await runPlanLocked(repoRoot, planPath, deps, acquire);
  } finally {
    rmSync(lock, { force: true });
  }
}

async function runPlanLocked(repoRoot: string, planPath: string, deps: RunDeps, acquire: () => void): Promise<RunState> {
  const home = deps.home ?? homedir();
  const which = deps.which ?? defaultWhich;
  const review = deps.review ?? runReview;
  const notify = deps.notify ?? notifyUser;

  // 1. Parse and validate everything before touching git or the disk.
  const absPlan = isAbsolute(planPath) ? planPath : resolve(repoRoot, planPath);
  const markdown = readFileSync(absPlan, 'utf8');
  const plan = parsePlan(markdown, planPath);
  const loaded = deps.adapters ? null : loadAdapters(repoRoot, home);
  const adapters = deps.adapters ?? loaded!.adapters;
  const loadErrors = loaded?.errors ?? [];
  const verifications = deps.verifications ?? loadVerifications(home);
  const config: Config = loadConfig(repoRoot);
  const policy: Policy = loadPolicy(repoRoot, config);
  const problems = [
    ...validatePlan(plan, [...adapters.keys(), ...loadErrors.map((e) => e.tool)]),
    ...preflightTools(plan, adapters, verifications, which, loadErrors, policy, config.reviewModel),
  ];
  if (problems.length > 0) throw new Error(`Không thể chạy plan:\n- ${problems.join('\n- ')}`);
  acquire();
  const specPath = findSpecPath(markdown);
  const slug = plan.slug;
  const featBranch = `feat/${slug}`;

  // 2. State.
  const state = loadState(repoRoot, slug) ?? initState(plan);
  if (state.status === 'merged_to_dev') return state;
  recoverInterrupted(state);
  for (const t of plan.tasks) {
    state.tasks[t.id] ??= { status: 'pending', attempts: 0, block: null };
  }
  state.status = 'running';

  // 3. Branches, integration worktree, libraries.
  ensureExcluded(repoRoot, '.konoha/');
  ensureBranches(repoRoot, config.baseBranch, config.integrationBranch, featBranch);
  const integ = integrationWorktree(repoRoot, slug);
  // A killed run can leave a half-done merge or stray files in the integration worktree.
  try { git(integ, ['merge', '--abort']); } catch { /* no merge in progress */ }
  git(integ, ['reset', '--hard', 'HEAD']);
  git(integ, ['clean', '-fd']);
  const save = () => saveState(repoRoot, state);
  const emit = (type: EventType, taskId: number | null, role: 'program' | 'worker' | 'judge', summary: string,
    tool: string | null = null, modelRequested: string | null = null, model: string | null = null) =>
    appendEvent(repoRoot, { run: slug, type, taskId, role, tool, modelRequested, model, summary });

  if (!state.librariesInstalled) {
    installLibraries(integ, plan.libraries.map((l) => l.replace(/^\s*`|`\s*$/g, '')));
    state.librariesInstalled = true;
    if (plan.libraries.length > 0) emit('libraries_installed', null, 'program', plan.libraries.join('; '));
  }
  save();
  emit('run_started', null, 'program', `Bắt đầu chạy plan ${plan.path}`);
  for (const o of loaded?.overridden ?? []) {
    emit('tool_overridden', null, 'program', `Công cụ "${o.tool}" bị thay bởi file ${o.by}`, o.tool);
  }

  // Adopt tasks whose merge reached feat/<slug> but was never recorded (killed before the state was saved).
  for (const task of plan.tasks) {
    if (state.tasks[task.id].status !== 'pending') continue;
    const branch = `wt/${slug}/task-${task.id}`;
    let tip: string;
    try { tip = git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).trim(); } catch { continue; }
    const mergedTips = git(repoRoot, ['log', featBranch, '--merges', '--format=%P']).split('\n').map((l) => l.split(' ')[1]);
    if (!mergedTips.includes(tip)) continue;
    const tests = await runShell(config.testCommand, integ, config.workerTimeoutMinutes * 60_000);
    git(integ, ['clean', '-fd']);
    if (tests.code === 0) {
      state.tasks[task.id].status = 'merged';
      save();
      emit('task_merged', task.id, 'program', `Việc ${task.id} đã gộp từ lần chạy trước`, task.tool, task.model);
      removeTaskWorktree(repoRoot, slug, task.id);
    } else {
      try {
        if (git(integ, ['rev-parse', 'HEAD^2']).trim() === tip) undoLastMerge(integ);
      } catch { /* HEAD is not that merge */ }
    }
  }

  const toolLimits: Record<string, number> = {};
  for (const [name, a] of adapters) if (a.maxParallel !== null) toolLimits[name] = a.maxParallel;
  const timeoutMs = config.workerTimeoutMinutes * 60_000;
  const taskWt = (id: number) => join(repoRoot, '.konoha', 'worktrees', slug, `task-${id}`);

  const block = (task: PlanTask, kind: BlockKind, detail: string) => {
    state.tasks[task.id].status = 'blocked';
    state.tasks[task.id].block = { kind, detail };
    save();
    emit('task_blocked', task.id, 'program', `${kind}: ${detail}`, task.tool, task.model);
  };

  const runTask = async (task: PlanTask): Promise<void> => {
    const ts = state.tasks[task.id];
    const adapter = adapters.get(task.tool);
    if (!adapter) return block(task, 'tool_unavailable', `Công cụ "${task.tool}" không còn`);
    if (!which(adapter.binary)) return block(task, 'tool_unavailable', `Không tìm thấy lệnh "${adapter.binary}"`);
    if (!isAssignable(adapter, verifications, policy)) {
      return block(task, 'tool_unavailable', `Công cụ "${task.tool}" chưa xác minh cách ly`);
    }
    const reviewer = adapters.get('claude');
    if (!reviewer || !reviewer.hasMode('review')) return block(task, 'tool_unavailable', 'Không có công cụ review');

    const wt = createTaskWorktree(repoRoot, slug, task.id);
    if (config.setupCommand) {
      const setup = await runShell(config.setupCommand, wt, timeoutMs);
      if (setup.code !== 0) return block(task, 'worker_error', `setupCommand hỏng: ${setup.stderr.slice(0, 300)}`);
    }
    emit('task_started', task.id, 'program', `Bắt đầu việc ${task.id}: ${task.name}`, task.tool, task.model);

    let notes: string | null = null;
    for (;;) {
      // Sibling task worktrees are deliberately not guarded: concurrent workers would see each other's writes.
      const result = await runWorker({
        adapter,
        job: { worktree: wt, prompt: buildBrief(plan, task, specPath, notes), model: task.model, policy, mode: 'work' },
        guardPaths: [repoRoot, integ], timeoutMs, testCommand: config.testCommand,
        commitMessage: `feat: task ${task.id} ${task.name}`,
      });
      emit('worker_finished', task.id, 'worker', `Worker kết thúc: ${result.outcome}`, task.tool, task.model, result.model);
      if (result.outcome === 'no_changes' && notes !== null) {
        // The retry did not address the review notes: count it as a failed attempt.
        if (ts.attempts < config.maxReviewRetries) {
          ts.attempts += 1;
          save();
          continue;
        }
        return block(task, 'review_limit', notes);
      }
      if (result.outcome === 'blocked' && result.block) return block(task, result.block.kind, result.block.detail);
      if (result.outcome !== 'changed') {
        return block(task, BLOCK_FOR_OUTCOME[result.outcome] ?? 'worker_error', result.block?.detail ?? result.outcome);
      }

      let verdict;
      try {
        verdict = await review({
          adapter: reviewer, worktree: wt, plan, task, specPath, featBranch, testOutput: result.testOutput,
          reviewModel: config.reviewModel, policy, timeoutMs,
        });
      } catch (err) {
        if (err instanceof ReviewError) return block(task, err.kind, err.message);
        return block(task, 'worker_error', `Review lỗi: ${(err as Error).message}`);
      }
      if (verdict.verdict.verdict === 'pass') {
        emit('review_passed', task.id, 'judge', verdict.verdict.notes || 'Review đạt', 'claude', config.reviewModel, verdict.model);
        if (mergeTaskBranch(integ, `wt/${slug}/task-${task.id}`) === 'conflict') {
          return block(task, 'merge_conflict', 'Gộp vào nhánh tổng bị xung đột');
        }
        const tests = await runShell(config.testCommand, integ, timeoutMs);
        git(integ, ['clean', '-fd']);
        if (tests.code !== 0) {
          undoLastMerge(integ);
          return block(task, 'tests_failed_after_merge', tests.timedOut ? 'Test sau gộp quá giờ' : `${tests.stdout}${tests.stderr}`.slice(-500));
        }
        ts.status = 'merged';
        ts.block = null;
        save();
        emit('task_merged', task.id, 'program', `Đã gộp việc ${task.id} vào ${featBranch}`, task.tool, task.model, result.model);
        removeTaskWorktree(repoRoot, slug, task.id);
        return;
      }
      emit('review_failed', task.id, 'judge', verdict.verdict.notes, 'claude', config.reviewModel, verdict.model);
      if (verdict.verdict.planChange) return block(task, 'plan_change', verdict.verdict.planChange);
      if (ts.attempts < config.maxReviewRetries) {
        ts.attempts += 1;
        save();
        notes = verdict.verdict.notes;
        continue;
      }
      return block(task, 'review_limit', verdict.verdict.notes);
    }
  };

  // 4. Scheduling loop.
  const inFlight = new Map<number, Promise<void>>();
  for (;;) {
    const ready = nextRunnable(plan, state, config.maxParallel, toolLimits);
    for (const id of ready) {
      const task = plan.tasks.find((t) => t.id === id)!;
      state.tasks[id].status = 'running';
      state.tasks[id].block = null;
      save();
      const p = runTask(task).catch((err: Error) => block(task, 'worker_error', err.message)).finally(() => inFlight.delete(id));
      inFlight.set(id, p);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }

  // 6. Finish.
  const allMerged = plan.tasks.every((t) => state.tasks[t.id].status === 'merged');
  if (allMerged) {
    state.status = 'awaiting_merge';
    save();
    emit('run_awaiting_merge', null, 'program', 'Xong, chờ duyệt gộp vào dev');
    notify('Konoha', 'Xong, chờ bạn duyệt gộp vào dev');
  } else {
    state.status = 'needs_user';
    save();
    const lines = plan.tasks.filter((t) => state.tasks[t.id].status === 'blocked')
      .map((t) => `việc ${t.id}: ${state.tasks[t.id].block?.kind}`);
    emit('run_needs_user', null, 'program', lines.join('; ') || 'Có việc không chạy được');
    notify('Konoha', `Cần bạn xử lý: ${lines.join('; ') || 'có việc không chạy được'}`);
  }
  return state;
}

export function retryTask(repoRoot: string, slug: string, taskId: number): void {
  const state = loadState(repoRoot, slug);
  if (!state) throw new Error(`Chưa chạy plan "${slug}"`);
  const t = state.tasks[taskId];
  if (!t) throw new Error(`Không có task ${taskId}`);
  if (t.status === 'blocked') {
    t.status = 'pending';
    t.attempts = 0;
    t.block = null;
    saveState(repoRoot, state);
  }
}

export function mergeToDev(repoRoot: string, slug: string): 'merged' | 'conflict' | 'not_ready' {
  const state = loadState(repoRoot, slug);
  if (!state || state.status !== 'awaiting_merge') return 'not_ready';
  const config = loadConfig(repoRoot);
  const result = mergeFeatIntoDev(repoRoot, `feat/${slug}`, config.integrationBranch);
  if (result === 'merged') {
    state.status = 'merged_to_dev';
    saveState(repoRoot, state);
    appendEvent(repoRoot, { run: slug, type: 'run_merged_to_dev', taskId: null, role: 'program', tool: null,
      modelRequested: null, model: null, summary: `Đã gộp feat/${slug} vào ${config.integrationBranch}` });
  }
  return result;
}
