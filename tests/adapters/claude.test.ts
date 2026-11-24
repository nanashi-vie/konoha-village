import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../../src/adapters/load.js';
import { makeRepo } from '../helpers/tmpRepo.js';

const claude = loadAdapters(makeRepo(), mkdtempSync(join(tmpdir(), 'konoha-home-'))).adapters.get('claude')!;
const job = (over = {}) => ({ worktree: '/w', prompt: 'PROMPT', model: null as string | null,
  policy: { allowCommands: ['npm test'] }, mode: 'work' as const, ...over });

describe('claude built-in', () => {
  it('work mode args', () => {
    const args = claude.build(job({ model: 'sonnet' })).args;
    expect(args[args.indexOf('-p') + 1]).toBe('PROMPT');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args.join(' ')).toContain('Bash(npm test:*)');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(claude.build(job()).args).not.toContain('--model');
  });
  it('review mode is read-only', () => {
    const args = claude.build(job({ mode: 'review' })).args;
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('default');
    const joined = args.join(' ');
    expect(joined).not.toContain('Edit');
    expect(joined).not.toContain('Write');
    expect(claude.hasMode('review')).toBe(true);
  });
  it('reads the real model', () => {
    expect(claude.actualModel('{"modelUsage":{"claude-opus-4":{}}}')).toBe('claude-opus-4');
  });
});
