#!/usr/bin/env node
// Fake coding tool for tests. argv[2] = prompt. Mode comes from "FAKE_MODE=<mode>" in the prompt, else env FAKE_MODE.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prompt = process.argv[2] ?? '';
const mode = /FAKE_MODE=(\w+)/.exec(prompt)?.[1] ?? process.env.FAKE_MODE ?? 'none';
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));

switch (mode) {
  case 'write':
    writeFileSync('inside.txt', 'ok');
    break;
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
console.log(JSON.stringify({ result: 'done', mode, modelUsage: { 'fake-model-1': {} } }));
