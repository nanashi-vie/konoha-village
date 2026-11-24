import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../../src/adapters/load.js';
import { FORBIDDEN_FLAGS } from '../../src/adapters/types.js';
import { makeRepo } from '../helpers/tmpRepo.js';

const agy = loadAdapters(makeRepo(), mkdtempSync(join(tmpdir(), 'konoha-home-'))).adapters.get('agy')!;
const job = (over = {}) => ({ worktree: '/w', prompt: 'PROMPT', model: null as string | null,
  policy: { allowCommands: ['npm test', 'npm run lint'] }, mode: 'work' as const, ...over });

describe('agy built-in', () => {
  it('builds headless accept-edits command', () => {
    const args = agy.build(job({ model: 'gemini-4-hydrogen-low' })).args;
    expect(args[args.indexOf('-p') + 1]).toBe('PROMPT');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--mode') + 1]).toBe('accept-edits');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-4-hydrogen-low');
    expect(agy.build(job()).args).not.toContain('--model');
  });
  it('restricts commands through --settings allow rules', () => {
    const args = agy.build(job()).args;
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    expect(settings.permissions.allow).toEqual(['command(npm test)', 'command(npm run lint)']);
    const none = JSON.parse(agy.build(job({ policy: { allowCommands: [] } })).args.slice(-1)[0] === '' ? '{}' :
      agy.build(job({ policy: { allowCommands: [] } })).args[agy.build(job({ policy: { allowCommands: [] } })).args.indexOf('--settings') + 1]);
    expect(none.permissions.allow).toEqual([]);
  });
  it('has no review mode, needs verification, hides the real model', () => {
    expect(agy.hasMode('review')).toBe(false);
    expect(() => agy.build(job({ mode: 'review' }))).toThrow();
    expect(agy.isolation).toBe('verify');
    expect(agy.actualModel('{"status":"SUCCESS","response":"OK"}')).toBeNull();
  });
  it('never emits forbidden flags', () => {
    const args = agy.build(job({ model: 'm' })).args;
    for (const f of FORBIDDEN_FLAGS) expect(args).not.toContain(f);
  });
});
