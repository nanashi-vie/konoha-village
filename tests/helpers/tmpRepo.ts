import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'konoha-repo-')));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  run('init', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(root, 'README.md'), 'line1\nline2\nline3\n');
  run('add', '-A');
  run('commit', '-m', 'init');
  return root;
}
