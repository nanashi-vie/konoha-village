import type { Adapter } from './adapters/types.js';
import type { Policy } from './config.js';
import { git } from './git.js';
import type { Plan, PlanTask } from './plan/parse.js';
import { runInvocation } from './worker.js';

export class ReviewError extends Error {
  constructor(public kind: 'timeout' | 'tool_unavailable', message: string) {
    super(message);
  }
}

export interface Verdict { verdict: 'pass' | 'fail'; notes: string; planChange: string | null }

const BAD_FORMAT: Verdict = { verdict: 'fail', notes: 'Review trả về sai định dạng', planChange: null };

export function buildReviewPrompt(plan: Plan, task: PlanTask, specPath: string, diff: string, testOutput: string): string {
  return [
    `Bạn là người review. Hãy review việc ${task.id}: ${task.name} của plan ${plan.path}.`,
    `Spec: ${specPath}`,
    '',
    '## Nội dung việc',
    task.body,
    '',
    '## Thay đổi (git diff)',
    diff,
    '',
    '## Kết quả chạy test',
    testOutput,
    '',
    '## Tiêu chí',
    '- Đúng việc trong plan; đúng spec; test qua; không làm thừa ngoài việc.',
    '',
    'Trả lời CHỈ một khối JSON, không thêm chữ nào khác:',
    '{"verdict":"pass"|"fail","notes":"<nhận xét cụ thể, nếu fail thì nói cần sửa gì>","planChange":null|"<đề xuất đổi plan nếu việc này không thể làm đúng như plan>"}',
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [text.trim(), fenced?.[1]?.trim() ?? '', text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function parseVerdict(stdout: string): Verdict {
  let text: unknown;
  try {
    text = (JSON.parse(stdout) as { result?: unknown }).result;
  } catch {
    return BAD_FORMAT;
  }
  if (typeof text !== 'string') return BAD_FORMAT;
  const obj = extractJsonObject(text) as { verdict?: unknown; notes?: unknown; planChange?: unknown } | null;
  if (!obj || (obj.verdict !== 'pass' && obj.verdict !== 'fail')) return BAD_FORMAT;
  return {
    verdict: obj.verdict,
    notes: typeof obj.notes === 'string' ? obj.notes : '',
    planChange: typeof obj.planChange === 'string' && obj.planChange !== '' ? obj.planChange : null,
  };
}

export async function runReview(opts: {
  adapter: Adapter; worktree: string; plan: Plan; task: PlanTask; specPath: string;
  featBranch: string; testOutput: string; reviewModel: string; policy: Policy; timeoutMs: number;
}): Promise<{ verdict: Verdict; model: string | null }> {
  const diff = git(opts.worktree, ['diff', `${opts.featBranch}...HEAD`]);
  const prompt = buildReviewPrompt(opts.plan, opts.task, opts.specPath, diff, opts.testOutput);
  const inv = opts.adapter.build({
    mode: 'review', prompt, model: opts.reviewModel, policy: opts.policy, worktree: opts.worktree,
  });
  const run = await runInvocation(inv, opts.worktree, opts.timeoutMs);
  if (run.timedOut) throw new ReviewError('timeout', 'Review quá giờ');
  if (run.code === null) throw new ReviewError('tool_unavailable', `Không chạy được công cụ review: ${run.stderr.trim().slice(0, 300)}`);
  return { verdict: parseVerdict(run.stdout), model: opts.adapter.actualModel(run.stdout) };
}
