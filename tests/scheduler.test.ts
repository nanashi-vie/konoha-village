import { describe, it, expect } from 'vitest';
import { nextRunnable } from '../src/scheduler.js';
import { initState } from '../src/state/store.js';
import type { Plan, PlanTask } from '../src/plan/parse.js';

const t = (id: number, over: Partial<PlanTask> = {}): PlanTask => ({
  id, name: `T${id}`, tool: id === 1 ? 'agy' : 'claude', model: null, waitsOn: [], files: [], body: '', ...over,
});
function makePlan(over: Record<number, Partial<PlanTask>> = {}): Plan {
  return {
    path: 'p.md', slug: 'p', title: 'P', approved: true, libraries: [],
    tasks: [t(1, over[1]), t(2, { waitsOn: [1], ...over[2] }), t(3, { waitsOn: [1], ...over[3] }), t(4, { waitsOn: [2, 3], ...over[4] })],
  };
}

describe('nextRunnable', () => {
  it('starts with the root task', () => {
    const p = makePlan();
    expect(nextRunnable(p, initState(p), 3)).toEqual([1]);
  });
  it('releases dependents after a merge', () => {
    const p = makePlan(); const s = initState(p);
    s.tasks[1].status = 'merged';
    expect(nextRunnable(p, s, 3)).toEqual([2, 3]);
  });
  it('respects maxParallel', () => {
    const p = makePlan(); const s = initState(p);
    s.tasks[1].status = 'merged';
    expect(nextRunnable(p, s, 1)).toEqual([2]);
  });
  it('avoids file overlap, also with running tasks', () => {
    const p = makePlan({ 2: { files: ['src/app.ts'] }, 3: { files: ['src/app.ts'] } });
    const s = initState(p);
    s.tasks[1].status = 'merged';
    expect(nextRunnable(p, s, 3)).toEqual([2]);
    s.tasks[2].status = 'running';
    expect(nextRunnable(p, s, 3)).toEqual([]);
  });
  it('never runs a task whose dependency is blocked', () => {
    const p = makePlan(); const s = initState(p);
    s.tasks[1].status = 'merged'; s.tasks[2].status = 'blocked'; s.tasks[3].status = 'merged';
    expect(nextRunnable(p, s, 3)).toEqual([]);
  });
  it('returns nothing when all merged', () => {
    const p = makePlan(); const s = initState(p);
    for (const id of [1, 2, 3, 4]) s.tasks[id].status = 'merged';
    expect(nextRunnable(p, s, 3)).toEqual([]);
  });
  it('applies per-tool limits', () => {
    const p = makePlan(); const s = initState(p);
    s.tasks[1].status = 'merged';
    expect(nextRunnable(p, s, 3, { claude: 1 })).toEqual([2]);
    s.tasks[2].status = 'running';
    expect(nextRunnable(p, s, 3, { claude: 1 })).toEqual([]);
    s.tasks[2].status = 'pending';
    expect(nextRunnable(p, s, 3, {})).toEqual([2, 3]);
  });
});
