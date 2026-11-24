import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, parseVerdict, runReview } from '../src/review.js';
import { createTaskWorktree, ensureBranches, ensureExcluded } from '../src/git.js';
import { fakeAdapter } from './helpers/fakeTool.js';
import { makeRepo } from './helpers/tmpRepo.js';
import type { Plan, PlanTask } from '../src/plan/parse.js';

const wrap = (result: string) => JSON.stringify({ type: 'result', result });
const BAD = { verdict: 'fail', notes: 'Review trả về sai định dạng', planChange: null };

describe('parseVerdict', () => {
  it('reads a plain JSON result', () => {
    expect(parseVerdict(wrap('{"verdict":"pass","notes":"ok","planChange":null}')))
      .toEqual({ verdict: 'pass', notes: 'ok', planChange: null });
  });
  it('reads JSON inside a fenced block with surrounding text', () => {
    const text = 'Đây là kết quả:\n```json\n{"verdict":"fail","notes":"thiếu test","planChange":null}\n```\nHết.';
    expect(parseVerdict(wrap(text))).toEqual({ verdict: 'fail', notes: 'thiếu test', planChange: null });
  });
  it('keeps planChange', () => {
    expect(parseVerdict(wrap('{"verdict":"fail","notes":"n","planChange":"tách task 2"}')).planChange).toBe('tách task 2');
  });
  it('falls back on garbage or unknown verdict', () => {
    expect(parseVerdict(wrap('không phải json'))).toEqual(BAD);
    expect(parseVerdict(wrap('{"verdict":"maybe","notes":"x","planChange":null}'))).toEqual(BAD);
    expect(parseVerdict('rác')).toEqual(BAD);
  });
});

const task: PlanTask = { id: 1, name: 'Tạo bảng', tool: 'agy', model: null, waitsOn: [], files: [], body: 'nội dung' };
const plan: Plan = { path: 'docs/plan.md', slug: 'x', title: 'P', approved: true, libraries: [], tasks: [task] };

describe('buildReviewPrompt', () => {
  it('contains task name, spec path, diff and test output', () => {
    const p = buildReviewPrompt(plan, task, 'docs/spec.md', 'DIFF-TEXT', 'TEST-OUT');
    for (const s of ['Tạo bảng', 'docs/spec.md', 'DIFF-TEXT', 'TEST-OUT']) expect(p).toContain(s);
  });
});

describe('runReview', () => {
  it('runs the review mode and returns verdict and model', async () => {
    const root = makeRepo();
    ensureExcluded(root, '.konoha/');
    ensureBranches(root, 'main', 'dev', 'feat/x');
    const wt = createTaskWorktree(root, 'x', 1);
    const adapter = fakeAdapter('fake', 'none', { review: true });
    const r = await runReview({ adapter, worktree: wt, plan, task, specPath: 'docs/spec.md', featBranch: 'feat/x',
      testOutput: 'ok', reviewModel: 'opus', policy: { allowCommands: [] }, timeoutMs: 20000 });
    expect(r.model).toBe('fake-model-1');
    expect(r.verdict).toEqual(BAD); // fake tool prints no verdict
  });
});
