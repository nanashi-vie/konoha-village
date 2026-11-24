import type { Plan } from './parse.js';

function findCycle(plan: Plan): number[] | null {
  const deps = new Map(plan.tasks.map((t) => [t.id, t.waitsOn]));
  const state = new Map<number, 1 | 2>(); // 1 = on stack, 2 = done
  const stack: number[] = [];
  const visit = (id: number): number[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const next of deps.get(id) ?? []) {
      if (!deps.has(next)) continue;
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of plan.tasks) {
    const found = visit(t.id);
    if (found) return found;
  }
  return null;
}

export function validatePlan(plan: Plan, knownTools: string[]): string[] {
  const errors: string[] = [];
  if (!plan.approved) errors.push('Plan chưa được duyệt');

  const seen = new Set<number>();
  for (const t of plan.tasks) {
    if (seen.has(t.id)) errors.push(`Task ${t.id} bị trùng`);
    seen.add(t.id);
  }
  for (const t of plan.tasks) {
    if (t.tool === '') errors.push(`Task ${t.id}: thiếu "Giao cho"`);
    else if (!knownTools.includes(t.tool)) errors.push(`Task ${t.id}: công cụ "${t.tool}" không được hỗ trợ`);
    for (const w of t.waitsOn) {
      if (!seen.has(w)) errors.push(`Task ${t.id} chờ task ${w} không tồn tại`);
    }
  }
  const cycle = findCycle(plan);
  if (cycle) errors.push(`Vòng phụ thuộc: ${cycle.join(' → ')}`);
  return errors;
}
