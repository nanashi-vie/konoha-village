import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/plan/parse.js';
import { validatePlan } from '../src/plan/validate.js';

const skill = readFileSync(new URL('../skills/konoha-plan/SKILL.md', import.meta.url), 'utf8');
const example = /```markdown\n([\s\S]*?)\n```/.exec(skill)?.[1] ?? '';

describe('konoha-plan skill example', () => {
  it('is a draft that is rejected as unapproved', () => {
    const errs = validatePlan(parsePlan(example, 'docs/plans/2026-11-24-vi-du.md'), ['claude', 'agy']);
    expect(errs).toContain('Plan chưa được duyệt');
  });
  it('is valid once approved', () => {
    const approved = example.replace('nháp', 'đã duyệt');
    expect(validatePlan(parsePlan(approved, 'docs/plans/2026-11-24-vi-du.md'), ['claude', 'agy'])).toEqual([]);
  });
});
