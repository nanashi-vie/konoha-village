import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../../src/adapters/load.js';
import { FORBIDDEN_FLAGS } from '../../src/adapters/types.js';
import { makeRepo } from '../helpers/tmpRepo.js';

describe('no adapter emits forbidden flags', () => {
  it('holds for every loaded adapter and mode', () => {
    const { adapters } = loadAdapters(makeRepo(), mkdtempSync(join(tmpdir(), 'konoha-home-')));
    expect(adapters.size).toBeGreaterThan(0);
    for (const a of adapters.values()) {
      for (const mode of ['work', 'review'] as const) {
        if (!a.hasMode(mode)) continue;
        const args = a.build({ worktree: '/w', prompt: 'p', model: 'm', policy: { allowCommands: ['npm test'] }, mode }).args;
        for (const f of FORBIDDEN_FLAGS) {
          for (const piece of f.split(' ')) expect(args.includes(piece) && f === piece).toBe(false);
        }
        expect(args.join(' ')).not.toContain('--approval-mode yolo');
      }
    }
  });
});
