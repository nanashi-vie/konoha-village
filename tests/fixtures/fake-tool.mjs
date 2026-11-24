#!/usr/bin/env node
// Fake coding tool for tests. argv[2] = prompt. Mode comes from "FAKE_MODE=<mode>" in the prompt, else env FAKE_MODE.
// Modes: write | none | hang | block | outside | crash | escape | conflict
// Optional env: FAKE_PID_FILE, FAKE_LOG (append start/end lines), FAKE_DELAY_MS, FAKE_OUTSIDE_DIR.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prompt = process.argv[2] ?? '';
const mode = /FAKE_MODE=(\w+)/.exec(prompt)?.[1] ?? process.env.FAKE_MODE ?? 'none';
const taskNo = /Việc (\d+)/.exec(prompt)?.[1] ?? 'x';
const log = (event) => {
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ task: taskNo, event, t: Date.now() }) + '\n');
};
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
log('start');
if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));

switch (mode) {
  case 'write':
    writeFileSync('inside.txt', 'ok');
    appendFileSync(`task-${taskNo}.txt`, 'run\n');
    break;
  case 'conflict': {
    const lines = readFileSync('README.md', 'utf8').split('\n');
    lines[1] = `TASK-${taskNo}`;
    writeFileSync('README.md', lines.join('\n'));
    break;
  }
  case 'escape':
    writeFileSync('inside.txt', 'ok');
    writeFileSync('../outside.txt', 'escaped');
    break;
  case 'outside':
    writeFileSync(join(process.env.FAKE_OUTSIDE_DIR ?? '.', 'stray.txt'), 'x');
    break;
  case 'block':
    writeFileSync('.konoha-blocked.json', JSON.stringify({ kind: 'needs_library', detail: 'need lodash' }));
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    await new Promise(() => {});
    break;
  case 'crash':
    process.exit(1);
    break;
  default:
    break;
}
log('end');
console.log(JSON.stringify({ result: 'done', mode, modelUsage: { 'fake-model-1': {} } }));
