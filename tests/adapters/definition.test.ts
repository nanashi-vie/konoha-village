import { describe, it, expect } from 'vitest';
import { compileTool, resolveDefinition, type ToolDefinition } from '../../src/adapters/definition.js';
import type { WorkerJob } from '../../src/adapters/types.js';

const job = (over: Partial<WorkerJob> = {}): WorkerJob => ({
  worktree: '/wt', prompt: 'do it', model: null, policy: { allowCommands: [] }, mode: 'work', ...over,
});
const base: ToolDefinition = {
  binary: 'tool', modelFlag: ['--model', '{model}'], commandRule: 'Bash({cmd}:*)',
  modes: { work: { args: ['run', '{prompt}', '--cwd', '{worktree}', '{modelFlag}'] } },
};

describe('compileTool placeholders', () => {
  it('replaces prompt, worktree and modelFlag', () => {
    const a = compileTool('t', base, '/h');
    expect(a.build(job({ model: 'm1' })).args).toEqual(['run', 'do it', '--cwd', '/wt', '--model', 'm1']);
    expect(a.build(job()).args).toEqual(['run', 'do it', '--cwd', '/wt']);
  });
  it('expands allowCommands with the rule and drops the comma when empty', () => {
    const def: ToolDefinition = { ...base, modes: { work: { args: ['--allow', 'Read,{allowCommands}'] } } };
    const a = compileTool('t', def, '/h');
    expect(a.build(job({ policy: { allowCommands: ['npm test', 'npm run lint'] } })).args)
      .toEqual(['--allow', 'Read,Bash(npm test:*),Bash(npm run lint:*)']);
    expect(a.build(job()).args).toEqual(['--allow', 'Read']);
  });
  it('rejects unknown placeholder', () => {
    const def: ToolDefinition = { ...base, modes: { work: { args: ['{foo}'] } } };
    expect(() => compileTool('t', def, '/h')).toThrow(/\{foo\}/);
  });
  it('does not re-expand placeholders found inside the prompt', () => {
    const a = compileTool('t', base, '/h');
    expect(a.build(job({ prompt: '{worktree}' })).args[1]).toBe('{worktree}');
  });
  it('expands ~/ in env using homeDir', () => {
    const a = compileTool('t', { ...base, env: { X: '~/acc' } }, '/h');
    expect(a.build(job()).env.X).toBe('/h/acc');
  });
});

describe('compileTool forbidden flags', () => {
  it('rejects a template containing --yolo', () => {
    const def: ToolDefinition = { ...base, modes: { work: { args: ['--yolo', '{prompt}'] } } };
    expect(() => compileTool('t', def, '/h')).toThrow(/--yolo/);
  });
  it('rejects a model value that is a forbidden flag but allows it as prompt', () => {
    const a = compileTool('t', base, '/h');
    expect(() => a.build(job({ model: '-y' }))).toThrow();
    expect(() => a.build(job({ prompt: '-y' }))).not.toThrow();
  });
  it('rejects --approval-mode yolo as two tokens', () => {
    const def: ToolDefinition = { ...base, modes: { work: { args: ['--approval-mode', 'yolo'] } } };
    expect(() => compileTool('t', def, '/h')).toThrow(/yolo/);
  });
});

describe('compileTool misc', () => {
  it('requires binary and work mode', () => {
    expect(() => compileTool('t', { modes: base.modes }, '/h')).toThrow(/binary/);
    expect(() => compileTool('t', { binary: 'x' }, '/h')).toThrow(/work/);
  });
  it('throws when building a missing mode', () => {
    const a = compileTool('t', base, '/h');
    expect(a.hasMode('review')).toBe(false);
    expect(() => a.build(job({ mode: 'review' }))).toThrow();
  });
  it('defaults isolation to verify and maxParallel to null', () => {
    const a = compileTool('t', base, '/h');
    expect(a.isolation).toBe('verify');
    expect(a.maxParallel).toBeNull();
  });
  it('reads actualModel from modelFrom', () => {
    const a = compileTool('t', { ...base, modelFrom: { path: ['modelUsage'], firstKey: true } }, '/h');
    expect(a.actualModel('{"modelUsage":{"m-x":{}}}')).toBe('m-x');
    expect(a.actualModel('rác')).toBeNull();
    const b = compileTool('t', { ...base, modelFrom: { path: ['info', 'model'] } }, '/h');
    expect(b.actualModel('{"info":{"model":"zz"}}')).toBe('zz');
    expect(compileTool('t', base, '/h').actualModel('{"model":"x"}')).toBeNull();
  });
});

describe('hash', () => {
  it('is stable across key order, and changes with env or name', () => {
    const a = compileTool('t', base, '/h');
    const reordered: ToolDefinition = { modes: base.modes, commandRule: base.commandRule, modelFlag: base.modelFlag, binary: base.binary };
    expect(compileTool('t', reordered, '/h').hash).toBe(a.hash);
    expect(compileTool('t', { ...base, env: { A: '1' } }, '/h').hash)
      .not.toBe(compileTool('t', { ...base, env: { A: '2' } }, '/h').hash);
    expect(compileTool('u', base, '/h').hash).not.toBe(a.hash);
  });
});

describe('resolveDefinition', () => {
  const parent: ToolDefinition = { binary: 'p', env: { A: '1', B: '2' }, modes: { work: { args: ['p'] }, review: { args: ['r'] } } };
  it('merges env by key and replaces modes blockwise', () => {
    const r = resolveDefinition('c', { p: parent, c: { extends: 'p', env: { A: 'x' }, modes: { work: { args: ['c'] } } } });
    expect(r.env).toEqual({ A: 'x', B: '2' });
    expect(r.modes?.work?.args).toEqual(['c']);
    expect(r.modes?.review?.args).toEqual(['r']);
    expect(r.binary).toBe('p');
  });
  it('detects extends cycles', () => {
    expect(() => resolveDefinition('a', { a: { extends: 'b' }, b: { extends: 'a' } })).toThrow(/Vòng extends/);
  });
  it('rejects missing parent', () => {
    expect(() => resolveDefinition('a', { a: { extends: 'zzz' } })).toThrow(/không tìm thấy/);
  });
});
