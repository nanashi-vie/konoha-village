import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../../src/adapters/load.js';
import { makeRepo } from '../helpers/tmpRepo.js';

const home = () => mkdtempSync(join(tmpdir(), 'konoha-home-'));
function put(dir: string, name: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), content);
}
const job = { worktree: '/w', prompt: 'p', model: null, policy: { allowCommands: [] }, mode: 'work' as const };

describe('loadAdapters', () => {
  it('loads built-ins', () => {
    const r = loadAdapters(makeRepo(), home());
    expect(r.adapters.has('claude')).toBe(true);
    expect(r.sources.claude).toBe('builtin');
  });
  it('builds an account tool from extends + env', () => {
    const h = home();
    put(join(h, '.config/konoha/tools'), 'claude-work',
      '{"extends":"claude","env":{"CLAUDE_CONFIG_DIR":"~/.claude-work"},"maxParallel":2}');
    const r = loadAdapters(makeRepo(), h);
    const a = r.adapters.get('claude-work')!;
    expect(a.maxParallel).toBe(2);
    expect(a.isolation).toBe('trusted');
    expect(a.build(job).env.CLAUDE_CONFIG_DIR).toBe(`${h}/.claude-work`);
    expect(r.sources['claude-work']).toBe('user');
  });
  it('records overrides when repo file shadows user file', () => {
    const h = home(); const repo = makeRepo();
    const body = '{"binary":"x","modes":{"work":{"args":["{prompt}"]}}}';
    put(join(h, '.config/konoha/tools'), 'mine', body);
    put(join(repo, '.konoha/tools'), 'mine', body);
    const r = loadAdapters(repo, h);
    expect(r.overridden).toContainEqual({ tool: 'mine', by: 'repo' });
    expect(r.sources.mine).toBe('repo');
  });
  it('reports broken files without loading them', () => {
    const h = home();
    put(join(h, '.config/konoha/tools'), 'broken', '{not json');
    const r = loadAdapters(makeRepo(), h);
    expect(r.adapters.has('broken')).toBe(false);
    const err = r.errors.find((e) => e.tool === 'broken');
    expect(err && err.message.length > 0).toBe(true);
  });
  it('rejects tools with forbidden flags, bad extends and unknown placeholders', () => {
    const h = home(); const dir = join(h, '.config/konoha/tools');
    put(dir, 'evil', '{"binary":"x","modes":{"work":{"args":["--yolo","{prompt}"]}}}');
    put(dir, 'orphan', '{"extends":"nothing"}');
    put(dir, 'weird', '{"binary":"x","modes":{"work":{"args":["{foo}"]}}}');
    put(dir, 'cyc1', '{"extends":"cyc2"}');
    put(dir, 'cyc2', '{"extends":"cyc1"}');
    const r = loadAdapters(makeRepo(), h);
    for (const n of ['evil', 'orphan', 'weird', 'cyc1', 'cyc2']) {
      expect(r.adapters.has(n)).toBe(false);
      expect(r.errors.some((e) => e.tool === n)).toBe(true);
    }
    expect(r.errors.find((e) => e.tool === 'evil')!.message).toContain('--yolo');
  });
  it('rejects a tool whose model is a forbidden flag only at build time', () => {
    const r = loadAdapters(makeRepo(), home());
    expect(() => r.adapters.get('claude')!.build({ ...job, model: '-y' })).toThrow();
  });
});
