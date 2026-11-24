import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, readEvents } from '../../src/state/events.js';
import { runDir } from '../../src/state/store.js';

describe('events', () => {
  it('appends one JSON line per event and reads them back', () => {
    const root = mkdtempSync(join(tmpdir(), 'konoha-ev-'));
    const base = { run: 'demo', type: 'run_started' as const, taskId: null, role: 'program' as const,
      tool: null, modelRequested: null, model: null, summary: 'x' };
    appendEvent(root, base);
    appendEvent(root, { ...base, type: 'task_started', taskId: 1 });
    const events = readEvents(root, 'demo');
    expect(events).toHaveLength(2);
    expect(new Date(events[0].ts).toISOString()).toBe(events[0].ts);
    const lines = readFileSync(join(runDir(root, 'demo'), 'events.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
  it('readEvents returns [] when no log', () => {
    expect(readEvents(mkdtempSync(join(tmpdir(), 'konoha-ev-')), 'none')).toEqual([]);
  });
});
