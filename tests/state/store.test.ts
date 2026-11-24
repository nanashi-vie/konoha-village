import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState, loadState, saveState, recoverInterrupted } from '../../src/state/store.js';
import type { Plan } from '../../src/plan/parse.js';

const plan: Plan = {
  path: 'docs/p.md', slug: 'demo', title: 'Demo', approved: true, libraries: [],
  tasks: [1, 2, 3].map((id) => ({ id, name: `T${id}`, tool: 'claude', model: null, waitsOn: [], files: [], body: '' })),
};
const tmp = () => mkdtempSync(join(tmpdir(), 'konoha-state-'));

describe('state store', () => {
  it('initState makes every task pending with 0 attempts', () => {
    const s = initState(plan);
    expect(s.slug).toBe('demo');
    expect(Object.values(s.tasks).every((t) => t.status === 'pending' && t.attempts === 0 && t.block === null)).toBe(true);
    expect(Object.keys(s.tasks)).toEqual(['1', '2', '3']);
  });
  it('save then load round-trips', () => {
    const root = tmp();
    const s = initState(plan);
    saveState(root, s);
    expect(loadState(root, 'demo')).toEqual(s);
  });
  it('load returns null when missing', () => {
    expect(loadState(tmp(), 'demo')).toBeNull();
  });
  it('recoverInterrupted turns running into pending only', () => {
    const s = initState(plan);
    s.tasks[1].status = 'running';
    s.tasks[2].status = 'merged';
    s.tasks[3].status = 'blocked';
    expect(recoverInterrupted(s)).toEqual([1]);
    expect(s.tasks[1].status).toBe('pending');
    expect(s.tasks[2].status).toBe('merged');
    expect(s.tasks[3].status).toBe('blocked');
  });
});
