import { describe, it, expect, vi } from 'vitest';
import { notifyUser } from '../src/notify.js';

describe('notifyUser', () => {
  it('calls osascript with the title and escapes quotes', () => {
    const calls: [string, string[]][] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    notifyUser('Tiêu đề', 'nói "xin chào"', (cmd, args) => { calls.push([cmd, args]); });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('osascript');
    const script = calls[0][1].join(' ');
    expect(script).toContain('Tiêu đề');
    expect(script).toContain('nói \\"xin chào\\"');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('does not throw when the notifier fails', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => notifyUser('t', 'm', () => { throw new Error('no osascript'); })).not.toThrow();
    log.mockRestore();
  });
});
