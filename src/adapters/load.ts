import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTool, resolveDefinition, type ToolDefinition } from './definition.js';
import type { Adapter } from './types.js';

// Trust is only kept by definitions that equal the built-in claude except for env and maxParallel.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}
function trustShape(def: ToolDefinition): string {
  const { env: _env, maxParallel: _max, isolation: _iso, extends: _ext, ...rest } = def;
  return JSON.stringify(canonical(rest));
}

export interface LoadResult {
  adapters: Map<string, Adapter>;
  errors: { tool: string; message: string }[];
  sources: Record<string, 'builtin' | 'user' | 'repo'>;
  overridden: { tool: string; by: 'user' | 'repo' }[];
}

type Source = 'builtin' | 'user' | 'repo';

export function loadAdapters(repoRoot: string, homeDir: string = homedir()): LoadResult {
  const tiers: { source: Source; dir: string }[] = [
    { source: 'builtin', dir: fileURLToPath(new URL('./builtin/', import.meta.url)) },
    { source: 'user', dir: join(homeDir, '.config', 'konoha', 'tools') },
    { source: 'repo', dir: join(repoRoot, '.konoha', 'tools') },
  ];
  const result: LoadResult = { adapters: new Map(), errors: [], sources: {}, overridden: [] };
  const defs: Record<string, ToolDefinition> = {};
  const parseErrors = new Set<string>();

  for (const { source, dir } of tiers) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const name = file.slice(0, -'.json'.length);
      if (result.sources[name] && source !== 'builtin') result.overridden.push({ tool: name, by: source });
      result.sources[name] = source;
      parseErrors.delete(name);
      delete defs[name];
      try {
        defs[name] = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ToolDefinition;
      } catch (err) {
        parseErrors.add(name);
        result.errors.push({ tool: name, message: `JSON sai: ${(err as Error).message}` });
      }
    }
  }

  let builtinShape: string | null = null;
  try {
    const builtinDefs: Record<string, ToolDefinition> = {};
    const dir = tiers[0].dir;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      builtinDefs[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ToolDefinition;
    }
    builtinShape = trustShape(resolveDefinition('claude', builtinDefs));
  } catch {
    builtinShape = null;
  }

  for (const name of Object.keys(defs)) {
    try {
      const resolved = resolveDefinition(name, defs);
      if (resolved.isolation === 'trusted' && trustShape(resolved) !== builtinShape) resolved.isolation = 'verify';
      result.adapters.set(name, compileTool(name, resolved, homeDir));
    } catch (err) {
      result.errors.push({ tool: name, message: (err as Error).message });
    }
  }
  return result;
}
