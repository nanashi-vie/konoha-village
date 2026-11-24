import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTool, type ToolDefinition } from '../../src/adapters/definition.js';
import type { Adapter } from '../../src/adapters/types.js';

export const FAKE_TOOL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-tool.mjs');

export function fakeDefinition(mode: string, opts: { review?: boolean; isolation?: 'trusted' | 'verify';
  maxParallel?: number; extraEnv?: Record<string, string> } = {}): ToolDefinition {
  const modeDef = { args: [FAKE_TOOL_PATH, '{prompt}'] };
  return {
    binary: process.execPath,
    isolation: opts.isolation ?? 'trusted',
    ...(opts.maxParallel !== undefined ? { maxParallel: opts.maxParallel } : {}),
    env: { FAKE_MODE: mode, ...opts.extraEnv },
    modelFrom: { path: ['modelUsage'], firstKey: true },
    modes: { work: modeDef, ...(opts.review ? { review: modeDef } : {}) },
  };
}

export function fakeAdapter(name: string, mode: string, opts: { review?: boolean; isolation?: 'trusted' | 'verify';
  maxParallel?: number; extraEnv?: Record<string, string> } = {}): Adapter {
  return compileTool(name, fakeDefinition(mode, opts));
}
