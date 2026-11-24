#!/usr/bin/env node
import { realpathSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAdapters } from './adapters/load.js';
import { checkTool, isAssignable, loadVerifications, recordVerification } from './adapters/verify.js';
import { loadConfig, loadPolicy, type Policy } from './config.js';
import { defaultWhich, mergeToDev, retryTask, runPlan } from './orchestrator.js';
import { parsePlan } from './plan/parse.js';
import { loadState } from './state/store.js';

const USAGE = `konoha — bộ điều phối plan
  konoha run <plan.md>            chạy hoặc chạy tiếp
  konoha status <plan.md>         xem trạng thái
  konoha retry <plan.md> <id>     đưa việc bị chặn về pending
  konoha merge <plan.md>          gộp feat/<slug> vào dev (khi đã xong)
  konoha tool list                liệt kê công cụ
  konoha tool check <tên>         xác minh cách ly của công cụ`;

const SOURCE_LABEL = { builtin: 'dựng sẵn', user: 'user', repo: 'repo' } as const;

export async function main(argv: string[], opts: { cwd?: string; home?: string } = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const [command, ...rest] = argv;
  const planArg = (): string | null => rest[0] ?? null;
  const readPlan = (path: string) => {
    const abs = isAbsolute(path) ? path : resolve(cwd, path);
    return parsePlan(readFileSync(abs, 'utf8'), path);
  };

  try {
    switch (command) {
      case 'run': {
        const p = planArg();
        if (!p) { console.log(USAGE); return 1; }
        const state = await runPlan(cwd, p, { home });
        console.log(`Trạng thái: ${state.status}`);
        return state.status === 'awaiting_merge' || state.status === 'merged_to_dev' ? 0 : 2;
      }
      case 'status': {
        const p = planArg();
        if (!p) { console.log(USAGE); return 1; }
        const plan = readPlan(p);
        const state = loadState(cwd, plan.slug);
        if (!state) { console.log('Chưa chạy'); return 0; }
        console.log(`Lượt chạy: ${state.status}`);
        for (const t of plan.tasks) {
          const s = state.tasks[t.id];
          const who = t.model ? `${t.tool} / ${t.model}` : t.tool;
          const why = s?.block ? `${s.block.kind}: ${s.block.detail}` : '';
          console.log(`${t.id} | ${t.name} | ${who} | ${s?.status ?? 'pending'} | ${why}`);
        }
        return 0;
      }
      case 'retry': {
        const p = planArg();
        const id = Number(rest[1]);
        if (!p || !Number.isInteger(id)) { console.log(USAGE); return 1; }
        retryTask(cwd, readPlan(p).slug, id);
        console.log(`Đã đưa việc ${id} về pending`);
        return 0;
      }
      case 'merge': {
        const p = planArg();
        if (!p) { console.log(USAGE); return 1; }
        const result = mergeToDev(cwd, readPlan(p).slug);
        if (result === 'merged') { console.log('Đã gộp vào dev'); return 0; }
        console.log(result === 'conflict' ? 'Gộp vào dev bị xung đột' : 'Chưa sẵn sàng: plan chưa ở trạng thái awaiting_merge');
        return 2;
      }
      case 'tool':
        return await toolCommand(rest, cwd, home);
      default:
        console.log(USAGE);
        return 1;
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

async function toolCommand(args: string[], cwd: string, home: string): Promise<number> {
  const [sub, name] = args;
  const loaded = loadAdapters(cwd, home);
  const verifications = loadVerifications(home);
  let policy: Policy = { allowCommands: [] };
  try { policy = loadPolicy(cwd, loadConfig(cwd)); } catch { /* no config yet: check with no commands */ }
  if (sub === 'list') {
    for (const tool of [...loaded.adapters.keys()].sort()) {
      const a = loaded.adapters.get(tool)!;
      const trust = a.isolation === 'trusted' ? 'tin sẵn' : isAssignable(a, verifications, policy) ? 'đã xác minh' : 'chưa xác minh';
      console.log(`${tool} ${SOURCE_LABEL[loaded.sources[tool]]} ${defaultWhich(a.binary) ? 'có lệnh' : 'thiếu lệnh'} ${trust}`);
    }
    for (const e of loaded.errors) console.log(`LỖI ${e.tool}: ${e.message}`);
    return 0;
  }
  if (sub === 'check' && name) {
    const adapter = loaded.adapters.get(name);
    if (!adapter) { console.log(`Không có công cụ "${name}"`); return 1; }
    const result = await checkTool(adapter, policy);
    if (!result.ok) { console.log(result.detail); return 2; }
    recordVerification({ tool: name, hash: adapter.hash, date: new Date().toISOString().slice(0, 10), commands: policy.allowCommands }, home);
    console.log(`Đã xác minh ${name}`);
    return 0;
  }
  console.log(USAGE);
  return 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
