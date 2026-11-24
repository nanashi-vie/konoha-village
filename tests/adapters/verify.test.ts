import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTool, isAssignable, loadVerifications, recordVerification } from '../../src/adapters/verify.js';
import { fakeAdapter } from '../helpers/fakeTool.js';

const policy = { allowCommands: [] };
const tmpLeft = () => readdirSync(tmpdir()).filter((n) => n.startsWith('konoha-check-')).length;
const verifyTool = (mode: string) => fakeAdapter('fake', mode, { isolation: 'verify' });

describe('checkTool', () => {
  it('passes when tool stays inside', async () => {
    expect((await checkTool(verifyTool('write'), policy, 20000)).ok).toBe(true);
  });
  it('fails and mentions outside.txt when tool escapes', async () => {
    const r = await checkTool(verifyTool('escape'), policy, 20000);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('outside.txt');
  });
  it('fails and mentions inside.txt when tool creates nothing', async () => {
    const r = await checkTool(verifyTool('none'), policy, 20000);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('inside.txt');
  });
  it('fails when tool crashes, leaving no temp dirs', async () => {
    const before = tmpLeft();
    expect((await checkTool(verifyTool('crash'), policy, 20000)).ok).toBe(false);
    expect(tmpLeft()).toBe(before);
  });
});

describe('verifications', () => {
  const home = () => mkdtempSync(join(tmpdir(), 'konoha-home-'));
  it('round-trips and defaults to {}', () => {
    const h = home();
    expect(loadVerifications(h)).toEqual({});
    recordVerification({ tool: 'fake', hash: 'abc', date: '2026-11-24' }, h);
    expect(loadVerifications(h)).toEqual({ fake: { tool: 'fake', hash: 'abc', date: '2026-11-24' } });
  });
  it('isAssignable follows trust and hash', () => {
    const a = verifyTool('write');
    expect(isAssignable(a, {})).toBe(false);
    expect(isAssignable(a, { fake: { tool: 'fake', hash: a.hash, date: 'x' } })).toBe(true);
    expect(isAssignable(a, { fake: { tool: 'fake', hash: 'other', date: 'x' } })).toBe(false);
    expect(isAssignable(fakeAdapter('t', 'write', { isolation: 'trusted' }), {})).toBe(true);
  });
});
