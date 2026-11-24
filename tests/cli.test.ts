import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { makeRepo } from './helpers/tmpRepo.js';
import { FAKE_TOOL_PATH, fakeDefinition } from './helpers/fakeTool.js';

afterEach(() => vi.restoreAllMocks());

async function cli(args: string[], cwd: string, home: string): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { lines.push(a.join(' ')); });
  const code = await main(args, { cwd, home });
  return { code, out: lines.join('\n') };
}
const home = () => mkdtempSync(join(tmpdir(), 'konoha-home-'));
function write(path: string, content: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
const PLAN = 'docs/plans/2026-11-23-demo.md';
const planText = `# Demo Implementation Plan
**Trạng thái plan:** đã duyệt
**Spec:** \`docs/spec.md\`

### Task 1: Một
**Giao cho:** fake
**Chờ:** —

FAKE_MODE=block
`;

function project() {
  const root = makeRepo();
  write(join(root, '.konoha', 'config.json'), JSON.stringify({ testCommand: 'echo ok' }));
  write(join(root, PLAN), planText);
  // hermetic: a fake "claude" (trusted, with review) shadows the built-in
  write(join(root, '.konoha', 'tools', 'claude.json'), JSON.stringify(fakeDefinition('write', { review: true, isolation: 'verify' })));
  write(join(root, '.konoha', 'tools', 'fake.json'), JSON.stringify(fakeDefinition('write', { isolation: 'verify' })));
  return root;
}

describe('konoha cli', () => {
  it('prints usage and exits 1 without a command', async () => {
    const r = await cli([], makeRepo(), home());
    expect(r.code).toBe(1);
    expect(r.out).toContain('konoha');
  });

  it('status before a run says Chưa chạy', async () => {
    const root = project();
    const r = await cli(['status', PLAN], root, home());
    expect(r.code).toBe(0);
    expect(r.out).toContain('Chưa chạy');
  });

  it('run blocks a task, status shows needs_library, merge exits 2, retry validates ids', async () => {
    const root = project(); const h = home();
    expect((await cli(['tool', 'check', 'fake'], root, h)).code).toBe(0);
    expect((await cli(['tool', 'check', 'claude'], root, h)).code).toBe(0);
    const run = await cli(['run', PLAN], root, h);
    expect(run.code).toBe(2);
    const status = await cli(['status', PLAN], root, h);
    expect(status.out).toContain('needs_library');
    expect((await cli(['merge', PLAN], root, h)).code).toBe(2);
    const retry = await cli(['retry', PLAN, '9'], root, h);
    expect(retry.code).toBe(1);
    expect(retry.out).toContain('Không có task');
    expect((await cli(['retry', PLAN, '1'], root, h)).code).toBe(0);
  });

  it('run refuses an unverified tool with exit 1', async () => {
    const root = project();
    const r = await cli(['run', PLAN], root, home());
    expect(r.code).toBe(1);
    expect(r.out).toContain('chưa xác minh cách ly');
  });

  it('tool list shows built-ins with their trust state', async () => {
    const r = await cli(['tool', 'list'], makeRepo(), home());
    const claude = r.out.split('\n').find((l) => l.startsWith('claude'))!;
    const agy = r.out.split('\n').find((l) => l.startsWith('agy'))!;
    expect(claude).toContain('tin sẵn');
    expect(agy).toContain('chưa xác minh');
  });

  it('tool check of an unknown tool exits 1', async () => {
    const r = await cli(['tool', 'check', 'ghost'], makeRepo(), home());
    expect(r.code).toBe(1);
    expect(r.out).toContain('Không có công cụ');
  });

  it('tool check records a verification that expires when the definition changes', async () => {
    const root = makeRepo(); const h = home();
    const file = join(root, '.konoha', 'tools', 'fake.json');
    write(file, JSON.stringify(fakeDefinition('write', { isolation: 'verify' })));
    const ok = await cli(['tool', 'check', 'fake'], root, h);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('Đã xác minh fake');
    expect(JSON.parse(readFileSync(join(h, '.config', 'konoha', 'verified.json'), 'utf8')).fake.hash).toMatch(/^[0-9a-f]{64}$/);
    const line = (out: string) => out.split('\n').find((l) => l.startsWith('fake'))!;
    expect(line((await cli(['tool', 'list'], root, h)).out)).toContain('đã xác minh');

    write(file, JSON.stringify(fakeDefinition('escape', { isolation: 'verify' })));
    expect(line((await cli(['tool', 'list'], root, h)).out)).toContain('chưa xác minh');
    const bad = await cli(['tool', 'check', 'fake'], root, h);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('outside.txt');
  });
});
void FAKE_TOOL_PATH;
