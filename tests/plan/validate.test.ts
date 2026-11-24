import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/plan/validate.js';
import type { Plan, PlanTask } from '../../src/plan/parse.js';

const task = (id: number, over: Partial<PlanTask> = {}): PlanTask => ({
  id, name: `T${id}`, tool: 'claude', model: null, waitsOn: [], files: [], body: '', ...over,
});
const plan = (tasks: PlanTask[], approved = true): Plan => ({
  path: 'p.md', slug: 'p', title: 'P', approved, libraries: [], tasks,
});
const KNOWN = ['claude', 'agy'];

describe('validatePlan', () => {
  it('rejects unapproved plan', () => {
    expect(validatePlan(plan([task(1)], false), KNOWN)).toContain('Plan chưa được duyệt');
  });
  it('rejects waiting on missing task', () => {
    expect(validatePlan(plan([task(1), task(2, { waitsOn: [9] })]), KNOWN))
      .toContain('Task 2 chờ task 9 không tồn tại');
  });
  it('detects dependency cycle', () => {
    const errs = validatePlan(plan([task(1, { waitsOn: [2] }), task(2, { waitsOn: [1] })]), KNOWN);
    expect(errs).toContain('Vòng phụ thuộc: 1 → 2 → 1');
  });
  it('rejects unknown tool', () => {
    expect(validatePlan(plan([task(1, { tool: 'cursor' })]), KNOWN))
      .toContain('Task 1: công cụ "cursor" không được hỗ trợ');
  });
  it('rejects missing Giao cho', () => {
    expect(validatePlan(plan([task(1, { tool: '' })]), KNOWN)).toContain('Task 1: thiếu "Giao cho"');
  });
  it('rejects duplicate ids', () => {
    expect(validatePlan(plan([task(1), task(1)]), KNOWN)).toContain('Task 1 bị trùng');
  });
  it('accepts a valid plan', () => {
    expect(validatePlan(plan([task(1), task(2, { tool: 'agy', waitsOn: [1] })]), KNOWN)).toEqual([]);
  });
});
