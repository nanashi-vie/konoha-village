import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { FORBIDDEN_FLAGS, type Adapter, type Invocation, type WorkerJob } from './types.js';

export interface ModeDef { args: string[] }
export interface ToolDefinition {
  extends?: string;
  binary?: string;
  env?: Record<string, string>;
  maxParallel?: number;
  isolation?: 'trusted' | 'verify';
  modelFlag?: string[];
  commandRule?: string;
  modelFrom?: { path: string[]; firstKey?: boolean };
  modes?: { work?: ModeDef; review?: ModeDef };
}

export function resolveDefinition(name: string, sources: Record<string, ToolDefinition>): ToolDefinition {
  const visit = (current: string, chain: string[]): ToolDefinition => {
    if (chain.includes(current)) throw new Error(`Vòng extends: ${[...chain, current].join(' → ')}`);
    const def = sources[current];
    if (!def) throw new Error(`Công cụ "${current}" không tìm thấy (được extends bởi "${chain[chain.length - 1] ?? name}")`);
    const { extends: parentName, ...own } = def;
    if (!parentName) return own;
    const parent = visit(parentName, [...chain, current]);
    const merged: ToolDefinition = { ...parent, ...own };
    if (parent.env || own.env) merged.env = { ...parent.env, ...own.env };
    if (parent.modes || own.modes) merged.modes = { ...parent.modes, ...own.modes };
    return merged;
  };
  if (!(name in sources)) throw new Error(`Công cụ "${name}" không tìm thấy`);
  return visit(name, []);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

function hashOf(name: string, def: ToolDefinition): string {
  return createHash('sha256').update(JSON.stringify(canonical({ name, def }))).digest('hex');
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

function checkPlaceholders(where: string, text: string, allowed: string[]): void {
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!allowed.includes(m[1])) throw new Error(`${where}: chỗ trống lạ {${m[1]}}`);
  }
}

function containsForbidden(args: string[]): string | null {
  for (const flag of FORBIDDEN_FLAGS) {
    const parts = flag.split(' ');
    const long = flag.startsWith('--');
    const norm = (x: string) => (long ? x.toLowerCase() : x);
    const want = parts.map(norm);
    for (let i = 0; i + want.length <= args.length; i++) {
      if (want.every((p, j) => norm(args[i + j]) === p)) return flag;
    }
    if (long) {
      const eq = want.join('=');
      if (args.some((a) => {
        const n = norm(a);
        return n === eq || (want.length === 1 && n.startsWith(`${eq}=`));
      })) return flag;
    }
  }
  return null;
}

function expandHome(value: string, homeDir: string): string {
  return value.startsWith('~/') ? homeDir + value.slice(1) : value;
}

export function compileTool(name: string, def: ToolDefinition, homeDir: string = homedir()): Adapter {
  if (!def.binary) throw new Error(`Công cụ "${name}": thiếu binary`);
  if (!def.modes?.work) throw new Error(`Công cụ "${name}": thiếu modes.work`);
  const binary = def.binary;
  if (def.maxParallel !== undefined && (!Number.isInteger(def.maxParallel) || def.maxParallel < 1)) {
    throw new Error(`Công cụ "${name}": maxParallel phải là số nguyên >= 1`);
  }
  for (const [k, v] of Object.entries(def.env ?? {})) {
    if (typeof v !== 'string') throw new Error(`Công cụ "${name}": env.${k} phải là chuỗi`);
  }
  for (const mode of ['work', 'review'] as const) {
    const args = def.modes[mode]?.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
      throw new Error(`Công cụ "${name}": modes.${mode}.args phải là mảng chuỗi`);
    }
  }
  checkPlaceholders(`Công cụ "${name}" binary`, binary, []);
  const modelFlag = def.modelFlag ?? [];
  const commandRule = def.commandRule;

  for (const el of modelFlag) checkPlaceholders(`Công cụ "${name}" modelFlag`, el, ['model']);
  if (commandRule !== undefined) checkPlaceholders(`Công cụ "${name}" commandRule`, commandRule, ['cmd', 'cmdEscaped']);
  for (const [k, v] of Object.entries(def.env ?? {})) {
    checkPlaceholders(`Công cụ "${name}" env.${k}`, v, ['prompt', 'worktree']);
  }
  for (const mode of ['work', 'review'] as const) {
    const args = def.modes[mode]?.args;
    if (!args) continue;
    for (const el of args) {
      checkPlaceholders(`Công cụ "${name}" modes.${mode}`, el, ['prompt', 'worktree', 'allowCommands', 'modelFlag']);
      if (el.includes('{modelFlag}') && el !== '{modelFlag}') {
        throw new Error(`Công cụ "${name}": {modelFlag} phải là một phần tử riêng`);
      }
      if (el.includes('{allowCommands}') && commandRule === undefined) {
        throw new Error(`Công cụ "${name}": dùng {allowCommands} nhưng thiếu commandRule`);
      }
    }
    const bad = containsForbidden(args.filter((a) => !a.includes('{prompt}')));
    if (bad) throw new Error(`Công cụ "${name}": mẫu lệnh chứa cờ cấm ${bad}`);
  }
  const badModelFlag = containsForbidden(modelFlag);
  if (badModelFlag) throw new Error(`Công cụ "${name}": modelFlag chứa cờ cấm ${badModelFlag}`);

  const substitute = (text: string, values: Record<string, string>): string =>
    text.replace(PLACEHOLDER, (_m, key: string) => values[key] ?? `{${key}}`);

  return {
    tool: name,
    binary,
    isolation: def.isolation ?? 'verify',
    hash: hashOf(name, def),
    maxParallel: def.maxParallel ?? null,
    hasMode: (mode) => Boolean(def.modes?.[mode]),
    build(job: WorkerJob): Invocation {
      const modeDef = def.modes?.[job.mode];
      if (!modeDef) throw new Error(`Công cụ "${name}" không có chế độ ${job.mode}`);
      if (job.model !== null && (job.model.startsWith('-') || /\s/.test(job.model))) {
        throw new Error(`Công cụ "${name}": tên model không hợp lệ "${job.model}"`);
      }
      const rules = commandRule
        ? job.policy.allowCommands.map((cmd) => commandRule
          .replace('{cmdEscaped}', () => JSON.stringify(cmd).slice(1, -1))
          .replace('{cmd}', () => cmd))
        : [];
      const values = { prompt: job.prompt, worktree: job.worktree };
      const out: { value: string; fromPrompt: boolean }[] = [];
      for (const el of modeDef.args) {
        if (el === '{modelFlag}') {
          if (job.model !== null) {
            for (const f of modelFlag) out.push({ value: f.replace('{model}', () => job.model as string), fromPrompt: false });
          }
          continue;
        }
        let text = el;
        if (text.includes('{allowCommands}')) {
          text = rules.length === 0
            ? text.replace(/,?\{allowCommands\}/g, '')
            : text.replace(/\{allowCommands\}/g, () => rules.join(','));
          if (text === '') continue;
        }
        out.push({ value: substitute(text, values), fromPrompt: el.includes('{prompt}') });
      }
      const bad = containsForbidden(out.filter((o) => !o.fromPrompt).map((o) => o.value));
      if (bad) throw new Error(`Công cụ "${name}": lệnh dựng ra chứa cờ cấm ${bad}`);
      const env = Object.fromEntries(Object.entries(def.env ?? {})
        .map(([k, v]) => [k, substitute(expandHome(v, homeDir), values)]));
      return { cmd: binary, args: out.map((o) => o.value), env };
    },
    actualModel(stdout: string): string | null {
      if (!def.modelFrom) return null;
      try {
        let node: unknown = JSON.parse(stdout);
        for (const key of def.modelFrom.path) {
          if (!node || typeof node !== 'object') return null;
          node = (node as Record<string, unknown>)[key];
        }
        if (def.modelFrom.firstKey) {
          if (!node || typeof node !== 'object') return null;
          node = Object.keys(node as object)[0];
        }
        return typeof node === 'string' && node !== '' ? node : null;
      } catch {
        return null;
      }
    },
  };
}
