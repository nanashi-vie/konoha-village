import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadPolicy } from '../src/config.js';

function repo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'konoha-cfg-'));
  mkdirSync(join(root, '.konoha'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, '.konoha', name), content);
  return root;
}

describe('config', () => {
  it('throws when config file is missing', () => {
    expect(() => loadConfig(repo())).toThrow(/testCommand/);
  });
  it('fills defaults', () => {
    const c = loadConfig(repo({ 'config.json': '{"testCommand":"npm test"}' }));
    expect(c).toEqual({
      testCommand: 'npm test', maxParallel: 3, maxReviewRetries: 2, workerTimeoutMinutes: 30,
      reviewModel: 'opus', baseBranch: 'main', integrationBranch: 'dev', setupCommand: null,
    });
  });
  it('policy defaults to testCommand', () => {
    const root = repo({ 'config.json': '{"testCommand":"npm test"}' });
    expect(loadPolicy(root, loadConfig(root))).toEqual({ allowCommands: ['npm test'] });
  });
});
